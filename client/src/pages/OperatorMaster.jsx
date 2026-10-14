import React, { useState, useEffect, useContext } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Card, CardBody, CardHeader, Col, Container, Modal, ModalBody, ModalFooter, ModalHeader, Label, Input, Row } from "reactstrap";
import DataTable from "react-data-table-component";
import DeleteModal from "../Components/Common/DeleteModal";
import FormsHeader from "../Components/Common/FormsModalHeader";
import FormsFooter from "../Components/Common/FormAddFooter";
import FormUpdateFooter from "../Components/Common/FormUpdateFooter";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { useInvalidateMachineOperators } from "../hooks/useMachineOperators";
import { useProcesses } from "../hooks/useProcesses";
import {
  createMachineOperator,
  deleteMachineOperator,
  getMachineOperatorById,
  updateMachineOperator,
  searchMachineOperators,
} from "../api/machineOperators.api";

/**
 * pages/OperatorMaster.jsx
 * ────────────────────────────
 * The shop-floor operator list behind Production Data Entry's "Operator"
 * dropdown — a name, the processes they work in and an active flag, on its own MachineOperator
 * model. Deliberately not the Employee Management "Operator" page: that one
 * is people who log in (roles, departments, passwords); this is who ran a
 * machine on a given shift, and never logs in at all.
 */
const initialState = { name: "", processes: [], isActive: true };

const OperatorMaster = () => {
  const toast = useAlert();
  const { currentPagePermissions = { read: true, write: true, edit: true, delete: true } } = useContext(MenuContext) || {};

  const [values, setValues] = useState(initialState);
  const [formErrors, setFormErrors] = useState({});
  const [isSubmit, setIsSubmit] = useState(false);
  const [filter, setFilter] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleteLoading, setIsDeleteLoading] = useState(false);

  const [operators, setOperators] = useState([]);
  const invalidateOperators = useInvalidateMachineOperators();
  const { data: processes = [] } = useProcesses();
  const activeProcesses = processes.filter((p) => p.isActive !== false);
  const [query, setQuery] = useState("");

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
    getMachineOperatorById(id)
      .then((res) => {
        const o = res.data.data;
        setValues({ name: o.name || "", processes: (o.processes || []).map((p) => String(p._id || p)), isActive: o.isActive });
      })
      .catch(() => toast.error("Failed to fetch operator details"))
      .finally(() => setIsLoading(false));
  };

  const tog_delete = (id) => {
    setmodal_delete(!modal_delete);
    setRemove_id(id);
  };

  const handleChange = (e) => setValues({ ...values, [e.target.name]: e.target.value });

  const validate = (v) => {
    const errors = {};
    if (!v.name.trim()) errors.name = "Operator name is required!";
    if (!v.processes.length) errors.processes = "Select at least one process";
    return errors;
  };

  const handleSave = (e) => {
    e.preventDefault();
    const errors = validate(values);
    setFormErrors(errors);
    setIsSubmit(true);
    if (Object.keys(errors).length) return;

    const data = { ...values, name: values.name.trim() };

    setIsLoading(true);
    const request = modalMode === "add" ? createMachineOperator(data) : updateMachineOperator(_id, data);
    request
      .then(() => {
        toast.success(modalMode === "add" ? "Operator Added Successfully!" : "Operator Updated Successfully!");
        closeModal();
        fetchOperators();
        invalidateOperators();
      })
      .catch((err) => toast.error(err?.response?.data?.message || "Failed to save operator. Please try again."))
      .finally(() => setIsLoading(false));
  };

  const handleDelete = (e) => {
    e.preventDefault();
    setIsDeleteLoading(true);
    deleteMachineOperator(remove_id)
      .then((res) => {
        setmodal_delete(false);
        toast.success(res?.data?.message || "Operator Removed Successfully!");
        fetchOperators();
        invalidateOperators();
      })
      .catch(() => {
        setmodal_delete(false);
        toast.error("Failed to delete operator. Please try again.");
      })
      .finally(() => setIsDeleteLoading(false));
  };

  useEffect(() => {
    const timeout = setTimeout(() => fetchOperators(), 500);
    return () => clearTimeout(timeout);
  }, [pageNo, column, sortDirection, query, filter]);

  const fetchOperators = async () => {
    setLoading(true);
    try {
      const response = await searchMachineOperators({
        skip: Math.max(0, (pageNo - 1) * perPage),
        per_page: perPage,
        sorton: column,
        sortdir: sortDirection,
        match: query,
        isActive: !!filter,
      });
      const res = response.data.data[0];
      setTotalRows(res?.count || 0);
      setOperators(res?.data || []);
    } catch (error) {
      console.error("Error fetching operators:", error);
      setOperators([]);
    } finally {
      setLoading(false);
    }
  };

  const col = [
    { name: "Sr No", selector: (row, index) => index + 1, maxWidth: "20px" },
    { name: "Operator Name", selector: (row) => row.name, sortable: true, sortField: "name", minWidth: "260px" },
    {
      name: "Process",
      cell: (row) =>
        row.processes?.length ? (
          <div className="d-flex flex-wrap gap-1 py-1">
            {row.processes.map((p) => (
              <span key={p._id} className="badge bg-primary-subtle text-primary">{p.processName}</span>
            ))}
          </div>
        ) : (
          <span className="text-muted small">Not assigned — shown in every process</span>
        ),
      minWidth: "220px",
    },
    { name: "Status", selector: (row) => (row.isActive ? "Active" : "Inactive"), minWidth: "100px" },
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
      minWidth: "140px",
    },
  ];

  document.title = `Operator Master | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;

  return (
    <React.Fragment>
      <div className="page-content">
        <Container fluid>
          <Row>
            <Col lg={12}>
              <Card>
                <CardHeader>
                  <FormsHeader
                    formName="Operators"
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
                      data={operators}
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

      <Modal isOpen={modalMode !== null} toggle={closeModal} centered backdrop="static" size="md">
        <ModalHeader className="p-3 border-bottom" toggle={closeModal}>
          {modalMode === "edit" ? "Update Operator" : "Add Operator"}
        </ModalHeader>
        <form noValidate>
          <ModalBody>
            <div className="form-floating mb-3">
              <Input type="text" name="name" value={values.name} onChange={handleChange} placeholder=" " maxLength={100} />
              <Label>
                Operator Name <span className="text-danger">*</span>
              </Label>
              {isSubmit && <p className="text-danger">{formErrors.name}</p>}
            </div>
            <div className="mb-3">
              <Label className="fw-semibold mb-1 d-block">
                Process <span className="text-danger">*</span>
              </Label>
              <div className="text-muted small mb-2">The entry forms offer this operator only on machines of the ticked processes.</div>
              <div className="d-flex flex-wrap gap-2">
                {activeProcesses.map((p) => {
                  const on = values.processes.includes(p._id);
                  return (
                    <label key={p._id} className={`btn btn-sm ${on ? "btn-primary" : "btn-outline-secondary"} d-inline-flex align-items-center gap-2 mb-0`}>
                      <input
                        type="checkbox"
                        className="form-check-input m-0"
                        checked={on}
                        onChange={() => setValues({ ...values, processes: on ? values.processes.filter((id) => id !== p._id) : [...values.processes, p._id] })}
                      />
                      {p.processName}
                    </label>
                  );
                })}
              </div>
              {isSubmit && formErrors.processes && <p className="text-danger small mb-0 mt-1">{formErrors.processes}</p>}
            </div>
            <div className="mt-3">
              <Input
                type="checkbox"
                className="form-check-input"
                name="isActive"
                checked={values.isActive}
                onChange={(e) => setValues({ ...values, isActive: e.target.checked })}
              />
              <Label className="form-check-label ms-1">Is Active</Label>
            </div>
          </ModalBody>
          <ModalFooter>
            {modalMode === "edit" ? (
              <FormUpdateFooter handleUpdate={handleSave} handleUpdateCancel={closeModal} isLoading={isLoading} />
            ) : (
              <FormsFooter handleSubmit={handleSave} handleSubmitCancel={closeModal} isLoading={isLoading} />
            )}
          </ModalFooter>
        </form>
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

export default OperatorMaster;
