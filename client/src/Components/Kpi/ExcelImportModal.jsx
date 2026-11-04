import React, { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "reactstrap";
import * as XLSX from "xlsx";

/**
 * Upload an old Excel sheet: download the template, pick the filled file, see
 * what will load (and what can't, row by row), then import.
 *
 *   columns  – [{ key, label, required?, hint? }] in template order; the
 *              upload is read by header name (case / spacing don't matter).
 *   sample   – one example row for the template, keyed like `columns`.
 *   onImport – (rows) → { imported, errors: [{ row, message }] }
 */
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9%]/g, "");

const ExcelImportModal = ({ isOpen, toggle, title, columns, sample, templateName, onImport, intro }) => {
  const fileRef = useRef(null);
  const [rows, setRows] = useState([]);
  const [problems, setProblems] = useState([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const reset = () => { setRows([]); setProblems([]); setFileName(""); setResult(null); if (fileRef.current) fileRef.current.value = ""; };
  const close = () => { reset(); toggle(); };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([columns.map((c) => c.label), columns.map((c) => sample[c.key] ?? "")]);
    ws["!cols"] = columns.map((c) => ({ wch: Math.max(14, c.label.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    XLSX.writeFile(wb, `${templateName}.xlsx`);
  };

  const readFile = async (file) => {
    if (!file) return;
    setResult(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
      const header = (raw[0] || []).map(norm);
      const index = Object.fromEntries(columns.map((c) => [c.key, header.indexOf(norm(c.label))]));
      const missing = columns.filter((c) => c.required && index[c.key] < 0).map((c) => c.label);
      if (missing.length) { setRows([]); setProblems([`The sheet has no column named: ${missing.join(", ")}. Download the template to see the headings.`]); return; }
      const out = [];
      const bad = [];
      raw.slice(1).forEach((r, i) => {
        if (!r.some((v) => String(v).trim() !== "")) return; // blank line
        const row = { row: i + 2 };
        columns.forEach((c) => { row[c.key] = index[c.key] >= 0 ? String(r[index[c.key]] ?? "").trim() : ""; });
        const gap = columns.filter((c) => c.required && row[c.key] === "").map((c) => c.label);
        if (gap.length) bad.push(`Row ${row.row}: ${gap.join(", ")} blank`);
        else out.push(row);
      });
      setRows(out);
      setProblems(bad);
    } catch {
      setRows([]);
      setProblems(["That file couldn't be read. Save it as .xlsx and try again."]);
    }
  };

  const doImport = async () => {
    setBusy(true);
    try {
      const r = await onImport(rows);
      setResult(r);
      if (!r?.errors?.length) setRows([]);
    } finally {
      setBusy(false);
    }
  };

  const shown = columns.filter((c) => !c.hideInPreview);

  return (
    <Modal isOpen={isOpen} toggle={close} centered scrollable size="lg">
      <ModalHeader toggle={close}>{title}</ModalHeader>
      <ModalBody>
        {intro && <p className="text-muted small">{intro}</p>}
        <ol className="small ps-3 mb-3">
          <li>Download the template and fill one row per month figure. Headings must stay as they are; extra columns are ignored.</li>
          <li>Pick the filled file. Check the preview — rows with a problem are listed and skipped.</li>
          <li>Click Import. A month that already has data entries keeps the entries; the uploaded figure fills the months that have none.</li>
        </ol>
        <div className="d-flex flex-wrap gap-2 mb-3">
          <button type="button" className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1" onClick={downloadTemplate}><Download size={15} /> Download template</button>
          <label className="btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-1 mb-0">
            <Upload size={15} /> Choose Excel file
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="d-none" onChange={(e) => readFile(e.target.files?.[0])} />
          </label>
          {fileName && <span className="small text-muted align-self-center">{fileName} · {rows.length} row{rows.length === 1 ? "" : "s"} ready</span>}
        </div>
        <details className="small mb-3">
          <summary className="text-muted">Columns</summary>
          <ul className="mb-0 ps-3 mt-1">
            {columns.map((c) => <li key={c.key}><strong>{c.label}</strong>{c.required ? " (required)" : ""}{c.hint ? ` — ${c.hint}` : ""}</li>)}
          </ul>
        </details>
        {problems.length > 0 && (
          <div className="alert alert-warning py-2 small mb-3">
            <div className="fw-semibold mb-1">Skipped</div>
            <ul className="mb-0 ps-3">{problems.slice(0, 30).map((p, i) => <li key={i}>{p}</li>)}{problems.length > 30 && <li>…and {problems.length - 30} more</li>}</ul>
          </div>
        )}
        {rows.length > 0 && (
          <div className="table-responsive border rounded" style={{ maxHeight: 280 }}>
            <table className="table table-sm mb-0 align-middle small">
              <thead className="table-light position-sticky top-0"><tr><th scope="col">Row</th>{shown.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0, 200).map((r) => <tr key={r.row}><td className="text-muted">{r.row}</td>{shown.map((c) => <td key={c.key}>{r[c.key]}</td>)}</tr>)}
                {rows.length > 200 && <tr><td colSpan={shown.length + 1} className="text-muted">…and {rows.length - 200} more rows</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {result && (
          <div className={`alert ${result.errors?.length ? "alert-warning" : "alert-success"} py-2 small mt-3 mb-0`}>
            <div className="fw-semibold">{result.imported} month figure{result.imported === 1 ? "" : "s"} loaded{result.created ? `, ${result.created} objective${result.created === 1 ? "" : "s"} created` : ""}.</div>
            {result.errors?.length > 0 && <ul className="mb-0 ps-3 mt-1">{result.errors.slice(0, 30).map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}{result.errors.length > 30 && <li>…and {result.errors.length - 30} more</li>}</ul>}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn btn-light" onClick={close} disabled={busy}>Close</button>
        <button type="button" className="btn btn-primary" onClick={doImport} disabled={busy || !rows.length}>{busy ? "Importing…" : `Import ${rows.length || ""}`.trim()}</button>
      </ModalFooter>
    </Modal>
  );
};

export default ExcelImportModal;
