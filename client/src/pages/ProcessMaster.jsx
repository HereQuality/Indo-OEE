import React, { useState, useEffect, useContext, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ExternalLink, Pencil, Trash2 } from "lucide-react";
import { Card, CardBody, CardHeader, Col, Container, Modal, ModalBody, ModalFooter, ModalHeader, Label, Input, Row } from "reactstrap";
import DataTable from "react-data-table-component";
import Select from "react-select";
import DeleteModal from "../Components/Common/DeleteModal";
import FormsHeader from "../Components/Common/FormsModalHeader";
import FormsFooter from "../Components/Common/FormAddFooter";
import FormUpdateFooter from "../Components/Common/FormUpdateFooter";
import WidgetPicker from "../Components/ProcessDashboard/WidgetPicker";
import "../Components/ProcessDashboard/processDashboard.css";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { useMachines, useInvalidateMachines } from "../hooks/useMachines";
import { useInvalidateProcesses } from "../hooks/useProcesses";
import { createProcess, deleteProcess, getProcessById, updateProcess, searchProcesses } from "../api/processes.api";
import { getAllMenus, getAllMenuGroups } from "../api/menus.api";
import { CHARTS_BY_KEY, DEFAULT_CHARTS, DEFAULT_STATS, STATS_BY_KEY, resolveWidgets } from "../utils/processDashboard";
import { toRolePath } from "../utils/roleUrl";

/**
 * Production > Processes.
 *
 * A process (VMC, PRESS, TRAUB M/C…) is what the Production Dashboard is
 * organised around. Here each one gets its machines, and the KPI tiles and
 * graphs its own dashboard shows — picked from a gallery with an example of
 * each. Processes are listed in the order they were created; there is no
 * sequence.
 */
const initialState = {
  processName: "",
  description: "",
  machineIds: [],
  stats: DEFAULT_STATS,
  charts: DEFAULT_CHARTS,
  // Which existing sidebar page this process's own data entry happens on —
  // that page's own menuUrl (e.g. "/hqepl/production/cnc-data-entry"), or ""
  // for not linked yet. `dataEntryMenuLabel` is that page's display name,
  // kept alongside purely so a non-admin (who can't fetch the menu list —
  // see the isAdmin-gated effect below) can still see what it's linked to,
  // read-only.
  dataEntryMenu: "",
  dataEntryMenuLabel: "",
  isActive: true,
};

const ProcessMaster = () => {
  const toast = useAlert();
  const { currentPagePermissions = { read: true, write: true, edit: true, delete: true }, isAdmin } = useContext(MenuContext) || {};
  const { roleSlug } = useParams();

  const [values, setValues] = useState(initialState);
  const [formErrors, setFormErrors] = useState({});
  const [isSubmit, setIsSubmit] = useState(false);
  const [filter, setFilter] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleteLoading, setIsDeleteLoading] = useState(false);

  const [processes, setProcesses] = useState([]);
  const { data: machines = [] } = useMachines();
  const invalidateMachines = useInvalidateMachines();
  const invalidateProcesses = useInvalidateProcesses();
  const [query, setQuery] = useState("");

  // Every page a process could point its Data Entry Page at, for that
  // picker — a process links to one, not the other way round, so this list
  // is the same regardless of which process is being edited. A "page" here
  // is either a MenuMaster item (sits under some sidebar group) or a
  // MenuGroupMaster top-level link (like "CNC Data Entry" itself) — both are
  // real, navigable pages, so both are offered, keyed by their own menuUrl
  // rather than a Mongo _id (see the doc comment on Process.dataEntryMenu
  // for why). GET /menus and /menu-groups are Super Admin-only server-side
  // (menu structure is a Super Admin capability, same as the dashboard KPI
  // picker below), so this is skipped entirely for anyone else — calling it
  // unconditionally 403'd for every non-admin who opened this page.
  const [menus, setMenus] = useState([]);
  const [menuGroups, setMenuGroups] = useState([]);
  useEffect(() => {
    if (!isAdmin) return;
    getAllMenus()
      .then((res) => setMenus((res?.data?.data || []).filter((m) => m.isActive && m.menuUrl)))
      .catch(() => setMenus([]));
    getAllMenuGroups()
      .then((res) => setMenuGroups((res?.data?.data || []).filter((g) => g.isActive && g.isLink && g.menuUrl)))
      .catch(() => setMenuGroups([]));
  }, [isAdmin]);
  const menuOptions = useMemo(
    () => [
      ...menuGroups.map((g) => ({ value: g.menuUrl, label: g.menuGroupName })),
      ...menus.map((m) => ({ value: m.menuUrl, label: m.menuName })),
    ],
    [menus, menuGroups],
  );

  const [_id, set_Id] = useState("");
  const [remove_id, setRemove_id] = useState("");

  // null = closed, "add" or "edit"
  const [modalMode, setModalMode] = useState(null);
  const [modal_delete, setmodal_delete] = useState(false);

  const [loading, setLoading] = useState(false);
  const [totalRows, setTotalRows] = useState(0);
  const [pageNo, setPageNo] = useState(1);
  const [column, setcolumn] = useState();
  const [sortDirection, setsortDirection] = useState();
  const perPage = 100;

  const closeModal = () => {
    setModalMode(null);
    setValues(initialState);
    setIsSubmit(false);
    setFormErrors({});
  };

  const openAdd = () => {
    setValues(initialState);
    setIsSubmit(false);
    setFormErrors({});
    setModalMode("add");
  };

  const openEdit = (id) => {
    set_Id(id);
    setIsSubmit(false);
    setFormErrors({});
    setModalMode("edit");
    setIsLoading(true);
    getProcessById(id)
      .then((res) => {
        const p = res.data.data;
        setValues({
          processName: p.processName,
          description: p.description || "",
          machineIds: (p.machines || []).map((m) => m._id),
          stats: resolveWidgets(p.stats, STATS_BY_KEY, DEFAULT_STATS).map((w) => w.key),
          charts: resolveWidgets(p.charts, CHARTS_BY_KEY, DEFAULT_CHARTS).map((w) => w.key),
          dataEntryMenu: p.dataEntryMenu || "",
          dataEntryMenuLabel: p.dataEntryMenuLabel || "",
          isActive: p.isActive,
        });
      })
      .catch(() => toast.error("Failed to fetch process details"))
      .finally(() => setIsLoading(false));
  };

  const tog_delete = (id) => {
    setmodal_delete(!modal_delete);
    setRemove_id(id);
  };

  const handleChange = (e) => setValues({ ...values, [e.target.name]: e.target.value });

  const validate = (v) => {
    const errors = {};
    if (!v.processName.trim()) errors.processName = "Process name is required!";
    else if (v.processName.length > 40) errors.processName = "Process name must not exceed 40 characters";
    if (v.description && v.description.length > 200) errors.description = "Description must not exceed 200 characters";
    return errors;
  };

  const payload = () => ({
    ...values,
    processName: values.processName.trim(),
  });

  const handleSave = (e) => {
    e.preventDefault();
    const errors = validate(values);
    setFormErrors(errors);
    setIsSubmit(true);
    if (Object.keys(errors).length) return;

    setIsLoading(true);
    const request = modalMode === "add" ? createProcess(payload()) : updateProcess(_id, payload());
    request
      .then(() => {
        toast.success(modalMode === "add" ? "Process Added Successfully!" : "Process Updated Successfully!");
        closeModal();
        fetchProcesses();
        invalidateProcesses();
        invalidateMachines();
      })
      .catch((err) => toast.error(err?.response?.data?.message || "Failed to save process. Please try again."))
      .finally(() => setIsLoading(false));
  };

  const handleDelete = (e) => {
    e.preventDefault();
    setIsDeleteLoading(true);
    deleteProcess(remove_id)
      .then((res) => {
        toast.success(res?.data?.message || "Process Removed Successfully!");
        fetchProcesses();
        invalidateProcesses();
        invalidateMachines();
      })
      .catch(() => toast.error("Failed to delete process. Please try again."))
      .finally(() => {
        setmodal_delete(false);
        setIsDeleteLoading(false);
      });
  };

  useEffect(() => {
    const timeout = setTimeout(() => fetchProcesses(), 500);
    return () => clearTimeout(timeout);
  }, [pageNo, column, sortDirection, query, filter]);

  const fetchProcesses = async () => {
    setLoading(true);
    try {
      const response = await searchProcesses({
        skip: Math.max(0, (pageNo - 1) * perPage),
        per_page: perPage,
        sorton: column,
        sortdir: sortDirection,
        match: query,
        isActive: !!filter,
      });
      const res = response.data.data[0];
      setTotalRows(res?.count || 0);
      setProcesses(res?.data || []);
    } catch (error) {
      console.error("Error fetching processes:", error);
      setProcesses([]);
    } finally {
      setLoading(false);
    }
  };

  // A machine lives in one process; picking one that's elsewhere moves it here.
  const machineOptions = useMemo(() => {
    const processName = Object.fromEntries(processes.map((p) => [p._id, p.processName]));
    return machines.map((m) => {
      const elsewhere = m.process && String(m.process) !== _id ? processName[m.process] : null;
      return { value: m._id, label: elsewhere ? `${m.machineName}  (now in ${elsewhere})` : m.machineName };
    });
  }, [machines, processes, _id, modalMode]);

  const col = [
    { name: "Sr No", selector: (row, index) => index + 1, maxWidth: "20px" },
    { name: "Process", selector: (row) => row.processName, sortable: true, sortField: "processName", minWidth: "140px" },
    {
      name: "Machines",
      cell: (row) =>
        row.machines?.length ? (
          <span className="d-flex flex-wrap gap-1 py-1">
            {row.machines.map((m) => (
              <span key={m._id} className="badge bg-light text-body border fw-semibold">{m.machineName}</span>
            ))}
          </span>
        ) : (
          <span className="text-muted">None assigned</span>
        ),
      minWidth: "220px",
      grow: 2,
    },
    {
      name: "Dashboard",
      selector: (row) =>
        `${resolveWidgets(row.stats, STATS_BY_KEY, DEFAULT_STATS).length} KPI tiles · ${resolveWidgets(row.charts, CHARTS_BY_KEY, DEFAULT_CHARTS).length} graphs`,
      minWidth: "150px",
    },
    {
      name: "Data Entry Page",
      cell: (row) =>
        row.dataEntryMenu ? (
          <Link
            to={toRolePath(row.dataEntryMenu, roleSlug)}
            className="d-inline-flex align-items-center gap-1 text-decoration-none"
            title={`Open ${row.dataEntryMenuLabel}`}
          >
            {row.dataEntryMenuLabel} <ExternalLink size={13} />
          </Link>
        ) : (
          <span className="text-muted">Not linked</span>
        ),
      minWidth: "160px",
    },
    { name: "Status", selector: (row) => (row.isActive ? "Active" : "Inactive"), maxWidth: "110px" },
    {
      name: "Action",
      cell: (row) => (
        <div className="d-flex gap-2">
          {currentPagePermissions.edit && (
            <button className="btn btn-sm btn-soft-success btn-icon fs-14" title="Edit" onClick={() => openEdit(row._id)}>
              <Pencil size={16} className="text-success" />
            </button>
          )}
          {currentPagePermissions.delete && (
            <button className="btn btn-sm btn-soft-danger btn-icon fs-14" title="Remove" onClick={() => tog_delete(row._id)}>
              <Trash2 size={16} className="text-danger" />
            </button>
          )}
        </div>
      ),
      minWidth: "120px",
    },
  ];

  document.title = `Process Master | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;

  return (
    <React.Fragment>
      <div className="page-content">
        <Container fluid>
          <Row>
            <Col lg={12}>
              <Card>
                <CardHeader>
                  <FormsHeader
                    formName="Processes"
                    filter={filter}
                    handleFilter={(e) => {
                      setPageNo(1);
                      setFilter(e.target.checked);
                    }}
                    tog_list={openAdd}
                    setQuery={setQuery}
                    showAddButton={currentPagePermissions.create}
                  />
                </CardHeader>
                <CardBody>
                  <div className="table-responsive table-card mt-1 mb-1 text-right">
                    <DataTable
                      columns={col}
                      data={processes}
                      progressPending={loading}
                      sortServer
                      onSort={(c, dir) => {
                        setcolumn(c.sortField);
                        setsortDirection(dir);
                      }}
                      pagination
                      paginationServer
                      paginationComponentOptions={{ noRowsPerPage: true }}
                      paginationTotalRows={totalRows}
                      paginationPerPage={perPage}
                      onChangePage={setPageNo}
                    />
                  </div>
                </CardBody>
              </Card>
            </Col>
          </Row>
        </Container>
      </div>

      <Modal isOpen={modalMode !== null} toggle={closeModal} centered size="xl" scrollable backdrop="static">
        <ModalHeader className="p-3 border-bottom" toggle={closeModal}>
          {modalMode === "edit" ? "Update Process" : "Add Process"}
        </ModalHeader>
        <ModalBody>
          <form noValidate onSubmit={handleSave}>
            <div className="form-floating mb-3">
              <Input type="text" name="processName" value={values.processName} onChange={handleChange} placeholder=" " maxLength={40} />
              <Label>
                Process Name <span className="text-danger">*</span>
              </Label>
              {isSubmit && <p className="text-danger">{formErrors.processName}</p>}
            </div>
            <div className="form-floating mb-3">
              <Input type="text" name="description" value={values.description} onChange={handleChange} placeholder=" " maxLength={200} />
              <Label>Description</Label>
              {isSubmit && <p className="text-danger">{formErrors.description}</p>}
            </div>
            <div className="mb-3">
              <Label className="mb-1">Machines in this process</Label>
              <Select
                isMulti
                classNamePrefix="select"
                options={machineOptions}
                value={machineOptions.filter((o) => values.machineIds.includes(o.value))}
                onChange={(picked) => setValues({ ...values, machineIds: (picked || []).map((o) => o.value) })}
                placeholder="Select machines…"
                noOptionsMessage={() => "No machines — add them in Production › Machines"}
                closeMenuOnSelect={false}
              />
              <div className="text-muted small mt-1">Entries made on these machines are what this process's dashboard shows.</div>
            </div>

            <div className="mb-3">
              <Label className="mb-1">Data Entry Page</Label>
              {isAdmin ? (
                <Select
                  classNamePrefix="select"
                  isClearable
                  options={menuOptions}
                  value={menuOptions.find((o) => o.value === values.dataEntryMenu) || null}
                  onChange={(picked) =>
                    setValues({ ...values, dataEntryMenu: picked?.value || "", dataEntryMenuLabel: picked?.label || "" })
                  }
                  placeholder="Not linked to a page"
                  noOptionsMessage={() => "No pages — add one in Operator Management › Menus"}
                />
              ) : (
                // Picking a page means browsing the full menu list, which is
                // a Super Admin-only capability server-side — a non-admin
                // just sees what's already linked, unchangeable here.
                <Input type="text" value={values.dataEntryMenuLabel || "Not linked to a page"} disabled />
              )}
              <div className="text-muted small mt-1">
                The existing sidebar page where this process's own entries get typed in — that page then scopes
                itself to this process's machines instead of offering every process's.
              </div>
            </div>

            {/* Same gate as the live dashboard's own Customize button (see
                ProcessDashboard.jsx) — dashboard layout is a Super Admin
                call, not something every process editor should be able to
                rearrange. A non-admin still creates/edits everything else on
                this form; they just get whatever stats/charts the process
                already has (or the defaults, until an admin sets it). */}
            {isAdmin && (
              <div className="mb-3">
                <Label className="mb-1 d-block fw-semibold">Dashboard — what this process shows</Label>
                <div className="text-muted small mb-3">Tick the KPI tiles and graphs this process's dashboard should show. Ticked cards are numbered in the order they appear — use the arrows to move one earlier or later.</div>
                <WidgetPicker stats={values.stats} charts={values.charts} onChange={({ stats, charts }) => setValues({ ...values, stats, charts })} />
              </div>
            )}

            <div>
              <Input
                type="checkbox"
                className="form-check-input"
                name="isActive"
                checked={values.isActive}
                onChange={(e) => setValues({ ...values, isActive: e.target.checked })}
              />
              <Label className="form-check-label ms-1">Is Active</Label>
            </div>
          </form>
        </ModalBody>
        <ModalFooter>
          {modalMode === "edit" ? (
            <FormUpdateFooter handleUpdate={handleSave} handleUpdateCancel={closeModal} isLoading={isLoading} />
          ) : (
            <FormsFooter handleSubmit={handleSave} handleSubmitCancel={closeModal} isLoading={isLoading} />
          )}
        </ModalFooter>
      </Modal>

      <DeleteModal
        show={modal_delete}
        handleDelete={handleDelete}
        toggle={(e) => {
          e?.preventDefault?.();
          setmodal_delete(false);
        }}
        setmodal_delete={setmodal_delete}
        disabled={isDeleteLoading}
      />
    </React.Fragment>
  );
};

export default ProcessMaster;
