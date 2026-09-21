"""Exploratory bounded PWA circuit synthesis with an explicit wall-time cap.
Affine leaves are a common search heuristic in both languages. Interior products
are excluded, so this is not the unrestricted original grammar. SMT work is never
reported as a single cheap candidate evaluation. Only examples reach synthesize.
"""
import argparse
import json
import time
from pathlib import Path
import z3


def expression(op, args, symbolic=False):
    if op == 'add': return args[0] + args[1]
    if op == 'sub': return args[0] - args[1]
    if op == 'mul': return args[0] * args[1]
    if op == 'neg': return -args[0]
    if symbolic:
        if op == 'min': return z3.If(args[0] <= args[1], args[0], args[1])
        if op == 'max': return z3.If(args[0] >= args[1], args[0], args[1])
    if op == 'min': return min(args)
    if op == 'max': return max(args)
    raise ValueError(op)


def execute(tree, values, macros, symbolic=False):
    if tree['op'] == 'arg': return values[tree['value']]
    if tree['op'] == 'const': return tree['value']
    args = [execute(a, values, macros, symbolic) for a in tree['args']]
    if tree['op'] in macros: return execute(macros[tree['op']]['body'], args, macros, symbolic)
    return expression(tree['op'], args, symbolic)


def constant(v): return dict(op='const', value=v, args=[])
def call(op, *args): return dict(op=op, args=list(args))
def plane(coeff): return call('add', call('add', call('mul', constant(coeff[0]), dict(op='arg', value=0, args=[])), call('mul', constant(coeff[1]), dict(op='arg', value=1, args=[]))), constant(coeff[2]))


def synthesize(examples, library, seed, milliseconds, max_nodes):
    started = time.perf_counter()
    end = started + milliseconds/1000
    macros = {m['name']: m for m in library}
    operators = [('add', 2), ('sub', 2), ('min', 2), ('max', 2), ('neg', 1)] + [(m['name'], m['arity']) for m in library]
    stages = []
    program = None
    example_executions = 0
    for count in range(1, max_nodes+1):
        if time.perf_counter() >= end: break
        stage_start = time.perf_counter()
        solver = z3.Solver()
        solver.set(random_seed=seed)
        ops = [z3.Int(f'op_{i}') for i in range(count)]
        selectors = [[z3.Int(f's_{i}_{a}') for a in range(3)] for i in range(count)]
        coefficients = [[[z3.Int(f'c_{i}_{a}_{j}') for j in range(3)] for a in range(3)] for i in range(count)]
        for i in range(count):
            solver.add(ops[i] >= 0, ops[i] < len(operators))
            for a in range(3):
                solver.add(selectors[i][a] >= -1, selectors[i][a] < i)
                for c in coefficients[i][a]: solver.add(c >= -4, c <= 4)
                for oid, (_, arity) in enumerate(operators):
                    if a >= arity: solver.add(z3.Implies(ops[i] == oid, z3.And(selectors[i][a] == -1, *[c == 0 for c in coefficients[i][a]])))
                solver.add(z3.Implies(selectors[i][a] >= 0, z3.And(*[c == 0 for c in coefficients[i][a]])))
            for oid, (op, _) in enumerate(operators):
                if op in ['add', 'min', 'max']: solver.add(z3.Implies(ops[i] == oid, selectors[i][0] <= selectors[i][1]))
        constrained = set()
        def add_example(eid):
            constrained.add(eid)
            e = examples[eid]
            x, y = [z3.RealVal(str(v)) for v in e['input']]
            values = []
            for i in range(count):
                args = []
                for a in range(3):
                    c = coefficients[i][a]
                    value = c[0]*x + c[1]*y + c[2]
                    for j in range(i): value = z3.If(selectors[i][a] == j, values[j], value)
                    args.append(value)
                alternatives = []
                for op, arity in operators:
                    alternatives.append(execute(macros[op]['body'], args[:arity], macros, True) if op in macros else expression(op, args[:arity], True))
                value = alternatives[-1]
                for j in reversed(range(len(alternatives)-1)): value = z3.If(ops[i] == j, alternatives[j], value)
                slot = z3.Real(f'v_{eid}_{i}')
                solver.add(slot == value)
                values.append(slot)
            target = z3.RealVal(str(e['output']))
            solver.add(values[-1] >= target-z3.RealVal('0.0000001'), values[-1] <= target+z3.RealVal('0.0000001'))
        for eid in range(min(9, len(examples))): add_example(eid)
        calls, models, status = 0, 0, 'unstarted'
        deadline = min(end, stage_start + milliseconds/1000/max_nodes)
        while time.perf_counter() < deadline:
            solver.set(timeout=max(1, int((deadline-time.perf_counter())*1000)))
            calls += 1
            result = solver.check()
            status = str(result)
            if result != z3.sat: break
            model = solver.model()
            decoded = []
            for i in range(count):
                op, arity = operators[model.eval(ops[i]).as_long()]
                args = []
                for a in range(arity):
                    select = model.eval(selectors[i][a]).as_long()
                    args.append(decoded[select] if select >= 0 else plane([model.eval(c).as_long() for c in coefficients[i][a]]))
                decoded.append(call(op, *args))
            models += 1
            candidate = decoded[-1]
            errors = [abs(execute(candidate, e['input'], macros)-e['output']) for e in examples]
            example_executions += len(examples)
            if max(errors) < 1e-7:
                program = candidate
                break
            # Counterexamples come only from the supplied synthesis examples.
            remaining = [i for i in range(len(examples)) if i not in constrained]
            if not remaining: status = 'numeric_mismatch'; break
            for eid in sorted(remaining, key=lambda i: errors[i], reverse=True)[:4]: add_example(eid)
        stats = {key: solver.statistics().get_key_value(key) for key in solver.statistics().keys()}
        stages.append(dict(nodes=count, status=status, calls=calls, models=models, constrainedExamples=len(constrained), wallMs=(time.perf_counter()-stage_start)*1000, statistics=stats))
        if program: break
    return dict(tree=program, stages=stages, exampleExecutions=example_executions, wallMs=(time.perf_counter()-started)*1000)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--milliseconds', type=int, default=3000)
    parser.add_argument('--nodes', type=int, default=6)
    args = parser.parse_args()
    path = Path(args.output)
    if path.exists(): raise FileExistsError('Preserve constraint experiment')
    data = json.loads(Path(args.input).read_text())
    rows = []
    for task in data['tasks']:
        for name, library in [('base', []), ('library', data['library'])]:
            r = synthesize(task['examples'], library, 42, args.milliseconds, args.nodes)
            check_error = None
            if r['tree']:
                macros = {m['name']: m for m in library}
                check_error = sum(abs(execute(r['tree'], e['input'], macros)-e['output']) for e in task['checks'])/len(task['checks'])
            row = dict(task=task['id'], group=task['group'], arm=name, result=r, checkError=check_error, solved=check_error is not None and check_error < 1e-8)
            rows.append(row)
            print(task['id'], name, row['solved'], round(r['wallMs']), flush=True)
    path.write_text(json.dumps(dict(z3Version=z3.get_version_string(), config=vars(args), note='Exploratory PWA circuit solver. Same bounded affine-leaf heuristic, per-task wall cap and supplied observations for both languages. Interior nonlinear products excluded. Solver statistics and construction time retained; checks never enter synthesis.', rows=rows)))

if __name__ == '__main__': main()
