import React, { useState, useEffect, useContext, useMemo } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Card, CardBody, CardHeader, Col, Container, Modal, ModalBody, ModalFooter, ModalHeader, Label, Input, Row } from "reactstrap";
import DataTable from "react-data-table-component";
import DeleteModal from "../Components/Common/DeleteModal";
import FormsHeader from "../Components/Common/FormsModalHeader";
import FormsFooter from "../Components/Common/FormAddFooter";
import FormUpdateFooter from "../Components/Common/FormUpdateFooter";
import NumberInput from "../Components/Production/NumberInput";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { useItems } from "../hooks/useItems";
import { useProcesses } from "../hooks/useProcesses";
import { useInvalidateWorkOrders } from "../hooks/useWorkOrders";
import { createWorkOrder, deleteWorkOrder, getWorkOrderById, searchWorkOrders, updateWorkOrder } from "../api/workOrders.api";

/**
 * pages/WorkOrderMaster.jsx
 * ───────────────────────────
 * Production › Work Orders: each work order's Work Order No. and the part it
 * makes. The VMC Data Entry form offers these in its Work Order No. box — picking
 * one fills in the part, its Drawing No., Setup No. and program.
 */

const initialState = {
  workOrderNo: "",
  item: "",
  orderQty: "",
  remarks: "",
  isActive: true,
};

const WorkOrderMaster = () => {
  const toast = useAlert();
  const { currentPagePermissions = { read: true, write: true, edit: true, delete: true } } = useContext(MenuContext) || {};

  const [values, setValues] = useState(initialState);
  const [formErrors, setFormErrors] = useState({});
  const [isSubmit, setIsSubmit] = useState(false);
  const [filter, setFilter] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleteLoading, setIsDeleteLoading] = useState(false);

  const [workOrders, setWorkOrders] = useState([]);
  const invalidateWorkOrders = useInvalidateWorkOrders();
  const [query, setQuery] = useState("");

  // The part picker lists the active parts, each told apart by its process and
  // drawing (two parts can share a name).
  const { data: items = [] } = useItems();
  const { data: processes = [] } = useProcesses();
  const processName = useMemo(() => Object.fromEntries(processes.map((p) => [p._id, p.processName])), [processes]);
  const partLabel = (it) => {
    const extra = [it.drawingNo, processName[it.process]].filter(Boolean).join(" · ");
    return extra ? `${it.itemName} — ${extra}` : it.itemName;
  };

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
    getWorkOrderById(id)
      .then((res) => {
        const wo = res.data.data;
        setValues({
          workOrderNo: wo.workOrderNo,
          item: wo.item || "",
          orderQty: wo.orderQty ?? "",
          remarks: wo.remarks || "",
          isActive: wo.isActive,
        });
      })
      .catch(() => toast.error("Failed to fetch work order details"))
      .finally(() => setIsLoading(false));
  };

  const tog_delete = (id) => {
    setmodal_delete(!modal_delete);
    setRemove_id(id);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setValues((v) => ({ ...v, [name]: value }));
  };

  const validate = (v) => {
    const errors = {};
    if (!v.workOrderNo.trim()) errors.workOrderNo = "Work Order No. is required!";
    if (!v.item) errors.item = "Select the part this work order makes!";
    if (v.orderQty !== "" && !(Number.isInteger(Number(v.orderQty)) && Number(v.orderQty) >= 0)) {
      errors.orderQty = "Order Quantity must be a whole number, 0 or more";
    }
    return errors;
  };

  const handleSave = (e) => {
    e.preventDefault();
    const errors = validate(values);
    setFormErrors(errors);
    setIsSubmit(true);
    if (Object.keys(errors).length) return;

    const data = {
      ...values,
      workOrderNo: values.workOrderNo.trim(),
      orderQty: values.orderQty === "" ? null : Number(values.orderQty),
      remarks: values.remarks.trim(),
    };

    setIsLoading(true);
    const request = modalMode === "add" ? createWorkOrder(data) : updateWorkOrder(_id, data);
    request
      .then(() => {
        toast.success(modalMode === "add" ? "Work Order Added Successfully!" : "Work Order Updated Successfully!");
        closeModal();
        fetchWorkOrders();
        invalidateWorkOrders();
      })
      .catch((err) => toast.error(err?.response?.data?.message || "Failed to save work order. Please try again."))
      .finally(() => setIsLoading(false));
  };

  const handleDelete = (e) => {
    e.preventDefault();
    setIsDeleteLoading(true);
    deleteWorkOrder(remove_id)
      .then((res) => {
        setmodal_delete(false);
        toast.success(res?.data?.message || "Work Order Removed Successfully!");
        fetchWorkOrders();
        invalidateWorkOrders();
      })
      .catch(() => {
        setmodal_delete(false);
        toast.error("Failed to delete work order. Please try again.");
      })
      .finally(() => setIsDeleteLoading(false));
  };

  useEffect(() => {
    const timeout = setTimeout(() => fetchWorkOrders(), 500);
    return () => clearTimeout(timeout);
  }, [pageNo, column, sortDirection, query, filter]);

  const fetchWorkOrders = async () => {
    setLoading(true);
    try {
      const response = await searchWorkOrders({
        skip: Math.max(0, (pageNo - 1) * perPage),
        per_page: perPage,
        sorton: column,
        sortdir: sortDirection,
        match: query,
        isActive: !!filter,
      });
      const res = response.data.data[0];
      setTotalRows(res?.count || 0);
      setWorkOrders(res?.data || []);
    } catch (error) {
      console.error("Error fetching work orders:", error);
      setWorkOrders([]);
    } finally {
      setLoading(false);
    }
  };

  // While editing, the part the work order already has stays selectable even if
  // that part has since been deactivated and so is not in the picker's list.
  const editingPart = workOrders.find((w) => w._id === _id)?.item;
  const partMissing = !!values.item && !items.some((it) => it._id === values.item);

  const col = [
    { name: "Sr No", selector: (row, index) => index + 1, maxWidth: "20px" },
    { name: "Work Order No.", selector: (row) => row.workOrderNo, sortable: true, sortField: "workOrderNo", minWidth: "160px" },
    { name: "Part Name", selector: (row) => row.item?.itemName || "—", minWidth: "220px" },
    { name: "Drawing No.", selector: (row) => row.item?.drawingNo || "", minWidth: "120px" },
    { name: "Setup No.", selector: (row) => row.item?.setupNo || "", minWidth: "110px" },
    { name: "Process", selector: (row) => processName[row.item?.process] || "—", minWidth: "110px" },
    { name: "Order Qty", selector: (row) => row.orderQty ?? "", sortable: true, sortField: "orderQty", minWidth: "110px" },
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

  document.title = `Work Orders | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;

  return (
    <React.Fragment>
      <div className="page-content">
        <Container fluid>
          <Row>
            <Col lg={12}>
              <Card>
                <CardHeader>
                  <FormsHeader
                    formName="Work Order"
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
                      data={workOrders}
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

      <Modal isOpen={modalMode !== null} toggle={closeModal} centered backdrop="static">
        <ModalHeader className="p-3 border-bottom" toggle={closeModal}>
          {modalMode === "edit" ? "Update Work Order" : "Add Work Order"}
        </ModalHeader>
        <form noValidate>
          <ModalBody>
            <div className="form-floating mb-3">
              <Input type="text" name="workOrderNo" value={values.workOrderNo} onChange={handleChange} placeholder=" " maxLength={40} />
              <Label>
                Work Order No. <span className="text-danger">*</span>
              </Label>
              {isSubmit && <p className="text-danger">{formErrors.workOrderNo}</p>}
            </div>
            <div className="form-floating mb-3">
              <Input type="select" name="item" value={values.item} onChange={handleChange}>
                <option value="">Select part</option>
                {partMissing && <option value={values.item}>{editingPart?.itemName || "Current part"} (inactive)</option>}
                {items.map((it) => (
                  <option key={it._id} value={it._id}>
                    {partLabel(it)}
                  </option>
                ))}
              </Input>
              <Label>
                Part <span className="text-danger">*</span>
              </Label>
              {isSubmit && <p className="text-danger">{formErrors.item}</p>}
            </div>
            <div className="form-floating mb-3">
              <NumberInput name="orderQty" value={values.orderQty} onChange={handleChange} decimals={false} placeholder=" " />
              <Label>Order Quantity (pcs)</Label>
              {isSubmit && <p className="text-danger">{formErrors.orderQty}</p>}
            </div>
            <div className="form-floating mb-3">
              <Input type="text" name="remarks" value={values.remarks} onChange={handleChange} placeholder=" " maxLength={300} />
              <Label>Remarks</Label>
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

export default WorkOrderMaster;
