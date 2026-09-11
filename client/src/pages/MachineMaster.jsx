import React, { useState, useEffect, useContext } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Card, CardBody, CardHeader, Col, Container, Modal, ModalBody, ModalFooter, ModalHeader, Label, Input, Row } from "reactstrap";
import DataTable from "react-data-table-component";
import DeleteModal from "../Components/Common/DeleteModal";
import ReferenceErrorModal from "../Components/Common/ReferenceErrorModal";
import FormsHeader from "../Components/Common/FormsModalHeader";
import FormsFooter from "../Components/Common/FormAddFooter";
import FormUpdateFooter from "../Components/Common/FormUpdateFooter";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { useInvalidateMachines } from "../hooks/useMachines";
import { createMachine, deleteMachine, getMachineById, updateMachine, searchMachines } from "../api/machines.api";

// Same tints the Excel sheet uses on its M.C. No. column.
const MACHINE_COLORS = [
  { value: "", label: "None" },
  { value: "#FFFF00", label: "Yellow" },
  { value: "#FFC000", label: "Orange" },
  { value: "#A9D08E", label: "Green" },
  { value: "#9BC2E6", label: "Blue" },
  { value: "#F8CBAD", label: "Peach" },
  { value: "#D9D2E9", label: "Lavender" },
  { value: "#D9D9D9", label: "Grey" },
];

const initialState = {
  machineName: "",
  description: "",
  color: "",
  sequence: "",
  isActive: true,
};

const MachineMaster = () => {
  const toast = useAlert();
  const { currentPagePermissions = { read: true, write: true, edit: true, delete: true } } = useContext(MenuContext) || {};

  const [values, setValues] = useState(initialState);
  const [formErrors, setFormErrors] = useState({});
  const [isSubmit, setIsSubmit] = useState(false);
  const [filter, setFilter] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleteLoading, setIsDeleteLoading] = useState(false);

  const [machines, setMachines] = useState([]);
  const invalidateMachines = useInvalidateMachines();
  const [query, setQuery] = useState("");

  const [_id, set_Id] = useState("");
  const [remove_id, setRemove_id] = useState("");
  const [referenceModal, setReferenceModal] = useState(false);
  const [referenceData, setReferenceData] = useState(null);

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
    getMachineById(id)
      .then((res) => {
        const m = res.data.data;
        setValues({
          machineName: m.machineName,
          description: m.description || "",
          color: m.color || "",
          sequence: m.sequence ?? "",
          isActive: m.isActive,
        });
      })
      .catch(() => toast.error("Failed to fetch machine details"))
      .finally(() => setIsLoading(false));
  };

  const tog_delete = (id) => {
    setmodal_delete(!modal_delete);
    setRemove_id(id);
  };

  const handleChange = (e) => setValues({ ...values, [e.target.name]: e.target.value });

  const validate = (v) => {
    const errors = {};
    if (!v.machineName.trim()) errors.machineName = "Machine No. is required!";
    else if (v.machineName.length > 20) errors.machineName = "Machine No. must not exceed 20 characters";
    if (v.sequence !== "" && !Number.isFinite(Number(v.sequence))) errors.sequence = "Sequence must be a number";
    if (v.description && v.description.length > 200) errors.description = "Description must not exceed 200 characters";
    return errors;
  };

  const payload = () => ({
    ...values,
    machineName: values.machineName.trim(),
    sequence: values.sequence === "" ? 0 : Number(values.sequence),
  });

  const handleSave = (e) => {
    e.preventDefault();
    const errors = validate(values);
    setFormErrors(errors);
    setIsSubmit(true);
    if (Object.keys(errors).length) return;

    setIsLoading(true);
    const request = modalMode === "add" ? createMachine(payload()) : updateMachine(_id, payload());
    request
      .then(() => {
        toast.success(modalMode === "add" ? "Machine Added Successfully!" : "Machine Updated Successfully!");
        closeModal();
        fetchMachines();
        invalidateMachines();
      })
      .catch((err) => toast.error(err?.response?.data?.message || "Failed to save machine. Please try again."))
      .finally(() => setIsLoading(false));
  };

  const handleDelete = (e) => {
    e.preventDefault();
    setIsDeleteLoading(true);
    deleteMachine(remove_id)
      .then((res) => {
        setmodal_delete(false);
        toast.success(res?.data?.message || "Machine Removed Successfully!");
        fetchMachines();
        invalidateMachines();
      })
      .catch((err) => {
        setmodal_delete(false);
        if (err.response && err.response.status === 409) {
          setReferenceData(err.response.data);
          setReferenceModal(true);
        } else {
          toast.error("Failed to delete machine. Please try again.");
        }
      })
      .finally(() => setIsDeleteLoading(false));
  };

  useEffect(() => {
    const timeout = setTimeout(() => fetchMachines(), 500);
    return () => clearTimeout(timeout);
  }, [pageNo, column, sortDirection, query, filter]);

  const fetchMachines = async () => {
    setLoading(true);
    try {
      const response = await searchMachines({
        skip: Math.max(0, (pageNo - 1) * perPage),
        per_page: perPage,
        sorton: column,
        sortdir: sortDirection,
        match: query,
        isActive: !!filter,
      });
      const res = response.data.data[0];
      setTotalRows(res?.count || 0);
      setMachines(res?.data || []);
    } catch (error) {
      console.error("Error fetching machines:", error);
      setMachines([]);
    } finally {
      setLoading(false);
    }
  };

  const col = [
    { name: "Sr No", selector: (row, index) => index + 1, maxWidth: "20px" },
    {
      name: "Machine No.",
      selector: (row) => row.machineName,
      cell: (row) => (
        <span className="d-inline-flex align-items-center gap-2">
          <span style={{ width: 14, height: 14, borderRadius: 3, background: row.color || "transparent", border: "1px solid #cbd5e1" }} />
          {row.machineName}
        </span>
      ),
      sortable: true,
      sortField: "machineName",
      minWidth: "130px",
    },
    { name: "Description", selector: (row) => row.description || "", minWidth: "180px" },
    { name: "Sequence", selector: (row) => row.sequence ?? 0, sortable: true, sortField: "sequence", maxWidth: "120px" },
    { name: "Status", selector: (row) => (row.isActive ? "Active" : "Inactive"), minWidth: "110px" },
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

  document.title = `Machine Master | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;

  return (
    <React.Fragment>
      <div className="page-content">
        <Container fluid>
          <Row>
            <Col lg={12}>
              <Card>
                <CardHeader>
                  <FormsHeader
                    formName="Machines"
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
                      data={machines}
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

      <Modal isOpen={modalMode !== null} toggle={closeModal} centered backdrop="static" keyboard={false}>
        <ModalHeader className="p-3 border-bottom" toggle={closeModal}>
          {modalMode === "edit" ? "Update Machine" : "Add Machine"}
        </ModalHeader>
        <form noValidate>
          <ModalBody>
            <Row>
              <Col md={6}>
                <div className="form-floating mb-3">
                  <Input type="text" name="machineName" value={values.machineName} onChange={handleChange} placeholder=" " maxLength={20} />
                  <Label>
                    Machine No. <span className="text-danger">*</span>
                  </Label>
                  {isSubmit && <p className="text-danger">{formErrors.machineName}</p>}
                </div>
              </Col>
              <Col md={6}>
                <div className="form-floating mb-3">
                  <Input type="number" name="sequence" value={values.sequence} onChange={handleChange} placeholder=" " />
                  <Label>Sequence (sheet order)</Label>
                  {isSubmit && <p className="text-danger">{formErrors.sequence}</p>}
                </div>
              </Col>
            </Row>
            <div className="form-floating mb-3">
              <Input type="text" name="description" value={values.description} onChange={handleChange} placeholder=" " maxLength={200} />
              <Label>Description</Label>
              {isSubmit && <p className="text-danger">{formErrors.description}</p>}
            </div>
            <div className="mb-3">
              <Label className="mb-2 d-block">Color on the sheet</Label>
              <div className="d-flex flex-wrap gap-2">
                {MACHINE_COLORS.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    title={c.label}
                    onClick={() => setValues({ ...values, color: c.value })}
                    className="d-inline-flex align-items-center gap-1 px-2 py-1 rounded border"
                    style={{
                      background: values.color === c.value ? "#eef2ff" : "#fff",
                      borderColor: values.color === c.value ? "#6366f1" : "#e2e8f0",
                      fontSize: 12,
                    }}
                  >
                    <span style={{ width: 14, height: 14, borderRadius: 3, background: c.value || "transparent", border: "1px solid #cbd5e1" }} />
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-3">
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

      {referenceModal && (
        <ReferenceErrorModal
          isOpen={referenceModal}
          toggle={() => {
            setReferenceModal(false);
            setReferenceData(null);
          }}
          title="Cannot Delete Machine"
          referenceData={referenceData}
        />
      )}
    </React.Fragment>
  );
};

export default MachineMaster;
