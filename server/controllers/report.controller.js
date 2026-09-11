const ProductionEntry = require("../models/ProductionEntry");
const Machine = require("../models/Machine");
const Process = require("../models/Process");
const { resolveMachineFilter } = require("../utils/entryQuery");
const { aggregateOee } = require("../utils/oeeAggregate");
const { buildOeeReportPdf, buildOeeDashboardPdf, buildDailyOeeTrendPdf, buildEfficiencyCardPdf } = require("../services/report.service");

const slug = (s) => String(s).replace(/[^a-z0-9]+/gi, "-");

exports.downloadOeeReport = async (req, res) => {
  try {
    const { machine, process, from, to, columns } = req.query;
    const today = new Date().toISOString().split("T")[0];
    const fromDate = from || today;
    const toDate = to || fromDate;

    const machineFilter = await resolveMachineFilter({ machine, process });
    const query = { date: { $gte: new Date(fromDate), $lte: new Date(toDate) } };
    if (machineFilter !== undefined) query.machine = machineFilter;

    const entries = await ProductionEntry.find(query).populate("machine", "machineName").lean();

    let machineName = "All Machines";
    if (machine) {
      const m = await Machine.findById(machine).select("machineName");
      machineName = m ? m.machineName : "Unknown Machine";
    }

    let processName = "All Processes";
    if (process) {
      const p = await Process.findById(process).select("processName");
      processName = p ? p.processName : "Unknown Process";
    }

    const columnList = columns
      ? String(columns).split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    const doc = buildOeeReportPdf({
      entries,
      filterDescription: `Process: ${processName}   ·   Machine: ${machineName}`,
      from: fromDate,
      to: toDate,
      columns: columnList,
    });

    const filename = `OEE-Report_${slug(processName)}_${slug(machineName)}_${fromDate}${
      toDate !== fromDate ? `_to_${toDate}` : ""
    }.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    console.error("Error generating OEE report:", err);
    res.status(500).json({ isOk: false, message: err.message });
  }
};

// Dashboard's "Download PDF" — always covers the From/To range only, never
// the Process/Machine dropdown filters at the top of the page (those are
// for narrowing what's shown on screen; the PDF is meant to be the full
// picture for that date range). Every active machine under every active
// process is listed, zero-filled if it has no entries that range (not
// skipped), and each process section leads with a combined total card. An
// explicit `processes` query param still narrows it if ever needed, but
// the Dashboard UI itself no longer sends one.
exports.downloadDashboardOeeReport = async (req, res) => {
  try {
    const { from, to, processes } = req.query;
    const today = new Date().toISOString().split("T")[0];
    const fromDate = from || today;
    const toDate = to || fromDate;
    const dateQuery = { $gte: new Date(fromDate), $lte: new Date(toDate) };

    const processIds = processes
      ? String(processes).split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    const processFilter = { isActive: true };
    if (processIds.length > 0) processFilter._id = { $in: processIds };

    const selectedProcesses = await Process.find(processFilter)
      .select("processName")
      .sort({ processName: 1 })
      .lean();

    if (selectedProcesses.length === 0) {
      return res.status(400).json({ isOk: false, message: "No matching process found" });
    }

    const selectedIdSet = new Set(selectedProcesses.map((p) => String(p._id)));
    const machines = await Machine.find({ isActive: true, processes: { $in: [...selectedIdSet] } })
      .select("machineName processes")
      .sort({ machineName: 1 })
      .lean();

    const entriesByMachine = new Map();
    for (const m of machines) {
      const entries = await ProductionEntry.find({ machine: m._id, date: dateQuery }).lean();
      entriesByMachine.set(String(m._id), entries);
    }

    const grouped = selectedProcesses.map((p) => {
      const machinesForProcess = machines.filter((m) =>
        (m.processes || []).some((pid) => String(pid) === String(p._id))
      );
      const machineRows = machinesForProcess.map((m) => ({
        machineName: m.machineName,
        agg: aggregateOee(entriesByMachine.get(String(m._id)) || []),
      }));
      const totalAgg = aggregateOee(machinesForProcess.flatMap((m) => entriesByMachine.get(String(m._id)) || []));
      return { processName: p.processName, total: totalAgg, machines: machineRows };
    });

    // Grand total across every unique machine — summed once from `machines`
    // (not from `grouped`, which would double-count any machine tagged
    // under more than one selected process).
    const overallAgg = aggregateOee(machines.flatMap((m) => entriesByMachine.get(String(m._id)) || []));

    const doc = buildOeeDashboardPdf({ grouped, overall: overallAgg, from: fromDate, to: toDate });

    const processSlug = selectedProcesses.map((p) => slug(p.processName)).join("_");
    const filename = `OEE-Report_${processSlug}_${fromDate}${toDate !== fromDate ? `_to_${toDate}` : ""}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    console.error("Error generating dashboard OEE report:", err);
    res.status(500).json({ isOk: false, message: err.message });
  }
};

// Dashboard's quick "Download PDF" on the Efficiency Report card — mirrors
// downloadOeeReport's exact filter resolution (same machine/process/from/to
// query params, same entries fetch) but renders the single on-screen stat
// card instead of a per-entry row table.
exports.downloadEfficiencyCardReport = async (req, res) => {
  try {
    const { machine, process, from, to } = req.query;
    const today = new Date().toISOString().split("T")[0];
    const fromDate = from || today;
    const toDate = to || fromDate;

    const machineFilter = await resolveMachineFilter({ machine, process });
    const query = { date: { $gte: new Date(fromDate), $lte: new Date(toDate) } };
    if (machineFilter !== undefined) query.machine = machineFilter;

    const entries = await ProductionEntry.find(query).lean();

    let machineName = "All Machines";
    if (machine) {
      const m = await Machine.findById(machine).select("machineName");
      machineName = m ? m.machineName : "Unknown Machine";
    }

    let processName = "All Processes";
    if (process) {
      const p = await Process.findById(process).select("processName");
      processName = p ? p.processName : "Unknown Process";
    }

    const agg = aggregateOee(entries);

    const doc = buildEfficiencyCardPdf({
      agg,
      from: fromDate,
      to: toDate,
      filterDescription: `Process: ${processName}   ·   Machine: ${machineName}`,
    });

    const filename = `OEE-Report_${slug(processName)}_${slug(machineName)}_${fromDate}${
      toDate !== fromDate ? `_to_${toDate}` : ""
    }.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    console.error("Error generating efficiency card report:", err);
    res.status(500).json({ isOk: false, message: err.message });
  }
};

// Dashboard's "Daily OEE Trend" chart download — the client already computed
// the per-day OEE% (respecting whatever process/machine filter is active on
// screen), so this just re-draws that exact same data as a PDF chart rather
// than re-deriving it server-side, guaranteeing the download always matches
// what's on screen.
exports.downloadDailyOeeTrendReport = async (req, res) => {
  try {
    const { month, target, filterDescription, data } = req.body;

    if (!month || !Array.isArray(data)) {
      return res.status(400).json({ isOk: false, message: "month and data are required" });
    }

    const cleanData = data
      .filter((d) => d && typeof d.date === "string")
      .map((d) => ({ date: d.date, OEE: Number(d.OEE) || 0 }));

    const doc = buildDailyOeeTrendPdf({
      data: cleanData,
      month,
      target: target != null ? Number(target) : 75,
      filterDescription,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Daily-OEE-Trend_${slug(month)}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    console.error("Error generating daily OEE trend report:", err);
    res.status(500).json({ isOk: false, message: err.message });
  }
};
