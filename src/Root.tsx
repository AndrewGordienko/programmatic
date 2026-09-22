import { lazy, Suspense, useEffect, useState } from "react";
const Workbench = lazy(() => import("./App"));
const Demo = lazy(() => import("./demo/DemoApp"));
const Joint = lazy(() => import("./joint/JointReport"));
const Meeting = lazy(() => import("./meeting/MeetingBrief"));
export function demoStep(hash: string): number | null {
  const match = /^#demo(?:\/([1-4]))?$/.exec(hash);
  return match ? Number(match[1] ?? 1) - 1 : null;
}
export default function Root() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const change = () => setHash(window.location.hash);
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const step = demoStep(hash);
  return (
    <Suspense
      fallback={<div className="route-loading">Opening the experiment…</div>}
    >
      {hash === "#joint" ? (
        <Joint />
      ) : hash === "" || hash === "#brief" || hash === "#live" || hash === "#heldout" ? (
        <Meeting />
      ) : step === null ? (
        <Workbench />
      ) : (
        <Demo step={step} />
      )}
    </Suspense>
  );
}
