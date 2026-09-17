import React from "react";
import { useSearchParams } from "react-router-dom";
import { Container } from "reactstrap";
import ProcessOverview from "../Components/ProcessDashboard/ProcessOverview";
import ProcessDashboard from "../Components/ProcessDashboard/ProcessDashboard";
import { useMachines } from "../hooks/useMachines";
import { useProcesses } from "../hooks/useProcesses";

/**
 * Production Dashboard.
 *
 * Lands on every process laid out under its group (ProcessOverview); picking
 * one opens that process's own dashboard (ProcessDashboard). Which process is
 * open lives in the query string — "?process=<id>", or "?process=all" for
 * every machine — rather than in the path, because page permissions are
 * matched on the path (see PageGuard): this way the one "Dashboard" menu
 * permission covers the landing page and every process under it.
 */
const ProductionDashboardPage = () => {
  const [params, setParams] = useSearchParams();
  const selected = params.get("process");

  const { data: machines = [] } = useMachines();
  const { data: processes = [], isLoading } = useProcesses();

  const process = selected && selected !== "all" ? processes.find((p) => p._id === selected) : null;
  const showDashboard = selected === "all" || !!process;

  document.title = `${process ? `${process.processName} Dashboard` : "Production Dashboard"} | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;

  return (
    <div className="page-content">
      <Container fluid>
        {showDashboard ? (
          <ProcessDashboard
            key={selected}
            process={process}
            machines={machines}
            onBack={() => setParams({})}
          />
        ) : (
          // An unknown id (deleted / deactivated process) falls back here once
          // the list has loaded, instead of showing an empty dashboard.
          <ProcessOverview processes={processes} machines={machines} loading={isLoading} onOpen={(id) => setParams({ process: id })} />
        )}
      </Container>
    </div>
  );
};

export default ProductionDashboardPage;
