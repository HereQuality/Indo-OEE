import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardBody, CardHeader, Container, Input } from "reactstrap";
import ProductionDashboard from "../Components/Production/ProductionDashboard";
import { useAlert } from "../context/AlertContext";
import { useMachines } from "../hooks/useMachines";
import { getProductionSheet } from "../api/productionSheet.api";
import { daysOfMonth, isoDay } from "../utils/productionSheet";

/**
 * Production Dashboard — the read-only roll-up that used to be a tab on the
 * Data Entry page, on its own route.
 *
 * Split out so neither page pays for the other's requests: opening Data Entry
 * no longer loads anything the charts need, and opening this page loads only
 * the month's entries and the machine list — not the item master or the
 * operator name list, which only the entry form uses.
 *
 * Every figure is still computed by ProductionDashboard from the same
 * formulas in utils/productionSheet.js that the entry form uses, so the two
 * pages cannot disagree.
 */

const ProductionDashboardPage = () => {
  const toast = useAlert();

  const [month, setMonth] = useState(() => isoDay(new Date()).slice(0, 7));
  const [machineFilter, setMachineFilter] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const { data: machines = [] } = useMachines();

  const days = useMemo(() => daysOfMonth(month), [month]);

  const fetchRows = useCallback(() => {
    setLoading(true);
    getProductionSheet({ from: days[0], to: days[days.length - 1], machine: machineFilter || undefined })
      .then((res) => setRows(res.data.data || []))
      .catch((err) => {
        toast.error(err?.response?.data?.message || "Failed to load entries");
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [days, machineFilter]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const periodLabel = useMemo(() => {
    const [y, m] = month.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
  }, [month]);

  document.title = `Production Dashboard | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;

  return (
    <React.Fragment>
      <div className="page-content">
        <Container fluid>
          <Card>
            <CardHeader>
              <div className="d-flex flex-wrap align-items-center gap-2">
                <h5 className="mb-0 fs-6 fw-semibold">Production Dashboard</h5>

                <div className="ms-auto d-flex flex-wrap align-items-center gap-2">
                  <Input
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    style={{ width: "165px" }}
                    bsSize="sm"
                  />
                  <Input
                    type="select"
                    value={machineFilter}
                    onChange={(e) => setMachineFilter(e.target.value)}
                    style={{ width: "170px" }}
                    bsSize="sm"
                  >
                    <option value="">All machines</option>
                    {machines.map((m) => (
                      <option key={m._id} value={m._id}>
                        {m.machineName}
                      </option>
                    ))}
                  </Input>
                </div>
              </div>
            </CardHeader>
            <CardBody>
              <ProductionDashboard
                rows={rows}
                machines={machines}
                loading={loading}
                periodLabel={periodLabel}
              />
            </CardBody>
          </Card>
        </Container>
      </div>
    </React.Fragment>
  );
};

export default ProductionDashboardPage;
