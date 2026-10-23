import React from "react";
import { useSearchParams } from "react-router-dom";
import { Container } from "reactstrap";
import ProcessOverview from "../Components/ProcessDashboard/ProcessOverview";
import ProcessDashboard from "../Components/ProcessDashboard/ProcessDashboard";
import { useMachines } from "../hooks/useMachines";
import { useProcesses } from "../hooks/useProcesses";
import { useProcessAccess } from "../utils/processAccess";

/**
 * Production Dashboard.
 *
 * Lands on every process laid out under its group (ProcessOverview); picking
 * one opens that process's own dashboard (ProcessDashboard). Which process is
 * open lives in the query string — "?process=<id>", or "?process=all" for
 * every machine — rather than in the path, because page permissions are
 * matched on the path (see PageGuard): this way the one "Dashboard" menu
 * permission covers the landing page and every process under it.
 *
 * Within it, a person only sees the processes whose data-entry page their
 * role can view (utils/processAccess.js) — tile and dashboard alike — and
 * "All machines" covers just those processes' machines. The server holds the
 * data back the same way.
 */
const ProductionDashboardPage = () => {
  const [params, setParams] = useSearchParams();
  const selected = params.get("process");

  const { data: machines = [] } = useMachines();
  const { data: allProcesses = [], isLoading } = useProcesses();
  const { canView, ready } = useProcessAccess();

  const processes = allProcesses.filter(canView);
  // Someone who can't view every process sees only their processes' machines —
  // not those of other processes, nor the ones in no process at all.
  const limited = processes.length < allProcesses.length;
  const shownIds = new Set(processes.map((p) => String(p._id)));
  const shownMachines = limited ? machines.filter((m) => shownIds.has(String(m.process?._id ?? m.process ?? ""))) : machines;

  const process = selected && selected !== "all" ? processes.find((p) => p._id === selected) : null;
  const showDashboard = (selected === "all" && shownMachines.length > 0) || !!process;

  document.title = `${process ? `${process.processName} Dashboard` : "Production Dashboard"} | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;

  return (
    <div className="page-content">
      <Container fluid>
        {showDashboard ? (
          <ProcessDashboard
            key={selected}
            process={process}
            machines={shownMachines}
            onBack={() => setParams({})}
          />
        ) : (
          // An unknown id (deleted / deactivated process, or one this role
          // can't view) falls back here once the list has loaded, instead of
          // showing an empty dashboard.
          <ProcessOverview
            processes={processes}
            machines={shownMachines}
            limited={limited}
            loading={isLoading || !ready}
            onOpen={(id) => setParams({ process: id })}
          />
        )}
      </Container>
    </div>
  );
};

export default ProductionDashboardPage;
