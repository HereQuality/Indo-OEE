import React, { useState, useEffect, useContext, useMemo, useCallback } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Card, CardBody, CardHeader, Col, Container, Modal, ModalBody, ModalFooter, ModalHeader, Label, Input, Row } from "reactstrap";
import DataTable from "react-data-table-component";
import DeleteModal from "../Components/Common/DeleteModal";
import FormsHeader from "../Components/Common/FormsModalHeader";
import FormsFooter from "../Components/Common/FormAddFooter";
import FormUpdateFooter from "../Components/Common/FormUpdateFooter";
import NumberInput from "../Components/Production/NumberInput";
import SearchablePartSelect from "../Components/Production/SearchablePartSelect";
import DatePicker from "../Components/Common/DatePicker";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { useItems } from "../hooks/useItems";
import { useProcesses } from "../hooks/useProcesses";
import { useInvalidateWorkOrders } from "../hooks/useWorkOrders";
import { createWorkOrder, deleteWorkOrder, getWorkOrderById, searchWorkOrders, updateWorkOrder,
  getWorkOrderProgress,
} from "../api/workOrders.api";

/**
 * pages/WorkOrderMaster.jsx
 * ───────────────────────────
 * Production › Work Orders: each work order's Work Order No., the part it
 * makes (picked by Part Name or Drawing No.), a description of that part, the
 * customer, the quantity and the dispatch date. The VMC Data Entry form offers
 * these in its Work Order No. box — picking one fills in the part, its Drawing
 * No., Setup No. and program.
 */

const initialState = {
  workOrderNo: "",
  item: "",
  partDescription: "",
  customerName: "",
  orderQty: "",
  dispatchDate: "",
  remarks: "",
  isActive: true,
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// "YYYY-MM-DD" that is a real calendar day ("2026-02-30" is not).
const isRealDay = (s) => {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// Dispatch dates are stored at UTC midnight, so the first ten characters of
// the ISO string are the day itself — no timezone shift.
const toDay = (d) => (d ? String(d).slice(0, 10) : "");
const fmtDay = (d) => (d ? toDay(d).split("-").reverse().join("/") : "");

// Same rules the server applies (controllers/workOrder.controller.js).
const validate = (v) => {
  const errors = {};
  if (!v.workOrderNo.trim()) errors.workOrderNo = "Work Order No. is required!";
  if (!v.item) errors.item = "Select the part this work order makes!";
  if (!v.partDescription.trim()) errors.partDescription = "Part Description is required!";
  if (String(v.orderQty).trim() === "") errors.orderQty = "Quantity is required!";
  else if (!(Number.isInteger(Number(v.orderQty)) && Number(v.orderQty) >= 1)) {
    errors.orderQty = "Quantity must be a whole number, 1 or more";
  }
  if (!v.dispatchDate) errors.dispatchDate = "Dispatch Date is required!";
  else if (!isRealDay(v.dispatchDate)) errors.dispatchDate = "Enter a valid Dispatch Date";
  return errors;
};

// A table header that wraps onto a second line instead of ending in "…".
const Head = ({ children }) => <span style={{ whiteSpace: "normal", lineHeight: 1.25 }}>{children}</span>;

const labelClass = "form-label mb-1";

// A labelled form field with its red message once Save has been pressed.
const Field = ({ label, required, error, children, ...col }) => (
  <Col {...col}>
    <Label className={labelClass}>
      {label} {required && <span className="text-danger">*</span>}
    </Label>
    {children}
    {error && <p className="text-danger small mb-0 mt-1">{error}</p>}
  </Col>
);

const WorkOrderMaster = () => {
  const toast = useAlert();
  const { currentPagePermissions = { read: true, write: true, edit: true, delete: true } } = useContext(MenuContext) || {};

  const [values, setValues] = useState(initialState);
  const [formErrors, setFormErrors] = useState({});
  // Read-only Production Complete Date, looked up from the Work Order No. typed above.
  const [progress, setProgress] = useState(null);
  const [isSubmit, setIsSubmit] = useState(false);
  const [filter, setFilter] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleteLoading, setIsDeleteLoading] = useState(false);

  const [workOrders, setWorkOrders] = useState([]);
  const invalidateWorkOrders = useInvalidateWorkOrders();
  const [query, setQuery] = useState("");

  // The part picker lists the active parts and finds one by its name or its
  // Drawing No.; each is told apart by its process (two parts can share a
  // name) — the open list shows the Drawing No. under each part.
  const { data: items = [] } = useItems();
  const { data: processes = [] } = useProcesses();
  const processName = useMemo(() => Object.fromEntries(processes.map((p) => [p._id, p.processName])), [processes]);
  const partLabel = useCallback(
    (it) => (processName[it.process] ? `${it.itemName} — ${processName[it.process]}` : it.itemName),
    [processName],
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
    getWorkOrderById(id)
      .then((res) => {
        const wo = res.data.data;
        setValues({
          workOrderNo: wo.workOrderNo,
          item: wo.item || "",
          partDescription: wo.partDescription || "",
          customerName: wo.customerName || "",
          orderQty: wo.orderQty ?? "",
          dispatchDate: toDay(wo.dispatchDate),
          remarks: wo.remarks || "",
          isActive: wo.isActive,
        });
      })
      .catch(() => toast.error("Failed to fetch work order details"))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    const no = values.workOrderNo.trim();
    if (modalMode === null || !no) {
      setProgress(null);
      return undefined;
    }
    let live = true;
    const t = setTimeout(() => {
      getWorkOrderProgress(no)
        .then((res) => live && setProgress(res.data.data))
        .catch(() => live && setProgress(null));
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [values.workOrderNo, modalMode]);

  const tog_delete = (id) => {
    setmodal_delete(!modal_delete);
    setRemove_id(id);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setValues((v) => ({ ...v, [name]: value }));
  };

  // Once Save has been pressed, the messages follow the form as it is fixed.
  useEffect(() => {
    if (isSubmit) setFormErrors(validate(values));
  }, [values, isSubmit]);

  const handleSave = (e) => {
    e.preventDefault();
    const errors = validate(values);
    setFormErrors(errors);
    setIsSubmit(true);
    if (Object.keys(errors).length) return;

    const data = {
      ...values,
      workOrderNo: values.workOrderNo.trim(),
      partDescription: values.partDescription.trim(),
      customerName: values.customerName.trim(),
      orderQty: Number(values.orderQty),
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
  const selectedPart = items.find((it) => it._id === values.item) || (partMissing ? editingPart : null);
  const err = (key) => (isSubmit ? formErrors[key] : undefined);

  // Long text — headers included — wraps rather than being cut off; the
  // min-widths keep every column readable, and narrower screens scroll the
  // table sideways inside its card (never the page).
  const col = [
    { name: <Head>Work Order No.</Head>, selector: (row) => row.workOrderNo, sortable: true, sortField: "workOrderNo", wrap: true, minWidth: "130px" },
    { name: <Head>Part Name</Head>, selector: (row) => row.item?.itemName || "—", wrap: true, minWidth: "140px" },
    { name: <Head>Drawing No.</Head>, selector: (row) => row.item?.drawingNo || "—", wrap: true, minWidth: "110px" },
    { name: <Head>Part Description</Head>, selector: (row) => row.partDescription || "—", wrap: true, minWidth: "170px", grow: 2 },
    { name: <Head>Customer</Head>, selector: (row) => row.customerName || "—", sortable: true, sortField: "customerName", wrap: true, minWidth: "120px" },
    { name: <Head>Quantity</Head>, selector: (row) => row.orderQty ?? "—", sortable: true, sortField: "orderQty", minWidth: "105px" },
    { name: <Head>Dispatch Date</Head>, selector: (row) => fmtDay(row.dispatchDate) || "—", sortable: true, sortField: "dispatchDate", minWidth: "120px" },
    {
      name: <Head>Production Complete Date</Head>,
      selector: (row) => (row.productionCompleteDate ? fmtDay(row.productionCompleteDate) : row.producedQty ? `${row.producedQty} of ${row.orderQty} pcs` : "—"),
      minWidth: "150px",
      wrap: true,
    },
    { name: <Head>Status</Head>, selector: (row) => (row.isActive ? "Active" : "Inactive"), minWidth: "90px" },
    {
      name: <Head>Action</Head>,
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
      minWidth: "100px",
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
                  <div className="table-responsive table-card mt-1 mb-1">
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

      <Modal isOpen={modalMode !== null} toggle={closeModal} centered backdrop="static" size="lg">
        <ModalHeader className="p-3 border-bottom" toggle={closeModal}>
          {modalMode === "edit" ? "Update Work Order" : "Add Work Order"}
        </ModalHeader>
        <form noValidate>
          <ModalBody>
            {/* The modal is only 500px wide below 992px, so the Work Order No. /
                Part pair sits side by side from lg up; Quantity / Dispatch Date
                are short enough to pair from sm up. Phones get one column. */}
            <Row className="g-3">
              <Field label="Work Order No." required error={err("workOrderNo")} xs={12} lg={6}>
                <Input
                  type="text"
                  name="workOrderNo"
                  value={values.workOrderNo}
                  onChange={handleChange}
                  placeholder="e.g. WO-101"
                  maxLength={40}
                  invalid={!!err("workOrderNo")}
                />
              </Field>
              <Field label="Part Name / Drawing No." required error={err("item")} xs={12} lg={6}>
                <SearchablePartSelect
                  items={items}
                  value={values.item}
                  itemName={partMissing ? `${editingPart?.itemName || "Current part"} (inactive)` : ""}
                  onSelect={(itemId) => setValues((v) => ({ ...v, item: itemId }))}
                  label={partLabel}
                  invalid={!!err("item")}
                  placeholder="Search part name or drawing no."
                />
                {selectedPart?.drawingNo && <div className="text-muted small mt-1 text-break">Drawing No.: {selectedPart.drawingNo}</div>}
              </Field>
              <Field label="Part Description" required error={err("partDescription")} xs={12}>
                <Input
                  type="textarea"
                  rows={2}
                  name="partDescription"
                  value={values.partDescription}
                  onChange={handleChange}
                  placeholder="Describe the part"
                  maxLength={300}
                  invalid={!!err("partDescription")}
                />
              </Field>
              <Field label="Customer Name" xs={12}>
                <Input
                  type="text"
                  name="customerName"
                  value={values.customerName}
                  onChange={handleChange}
                  placeholder="Optional"
                  maxLength={120}
                />
              </Field>
              <Field label="Quantity (pcs)" required error={err("orderQty")} xs={12} sm={6}>
                <NumberInput
                  name="orderQty"
                  value={values.orderQty}
                  onChange={handleChange}
                  decimals={false}
                  bsSize={undefined}
                  placeholder="e.g. 500"
                  invalid={!!err("orderQty")}
                />
              </Field>
              <Field label="Dispatch Date" required error={err("dispatchDate")} xs={12} sm={6}>
                {/* Matches the height and text size of the boxes beside it. */}
                <div className="[&>div>button]:min-h-[38px] [&>div>button]:text-sm">
                  <DatePicker
                    name="dispatchDate"
                    value={values.dispatchDate}
                    onChange={handleChange}
                    hasError={!!err("dispatchDate")}
                    placeholder="Select dispatch date"
                  />
                </div>
              </Field>
              <Field label="Production Complete Date" xs={12}>
                <Input
                  type="text"
                  readOnly
                  disabled
                  value={
                    progress?.productionCompleteDate
                      ? fmtDay(progress.productionCompleteDate)
                      : progress?.found && progress.producedQty
                        ? `Not complete yet — ${progress.producedQty} of ${progress.orderQty} pcs made`
                        : ""
                  }
                  placeholder="Fills in automatically from the entries made against this Work Order No."
                />
              </Field>
              <Field label="Remarks" xs={12}>
                <Input type="text" name="remarks" value={values.remarks} onChange={handleChange} placeholder="Optional" maxLength={300} />
              </Field>
              <Col xs={12}>
                <div className="form-check">
                  <Input
                    id="wo-isActive"
                    type="checkbox"
                    className="form-check-input"
                    name="isActive"
                    checked={values.isActive}
                    onChange={(e) => setValues({ ...values, isActive: e.target.checked })}
                  />
                  <Label className="form-check-label" htmlFor="wo-isActive">
                    Is Active
                  </Label>
                </div>
              </Col>
            </Row>
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
