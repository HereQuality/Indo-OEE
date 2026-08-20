import React, { useState, useEffect, useContext } from "react";
import DataTable from "react-data-table-component";
import { Container, Card, CardBody, Row, Col } from "reactstrap";
import { getTeamMembers } from "../api/employees.api";
import FormsModalHeader from "../Components/Common/FormsModalHeader";
import { useAlert } from "../context/AlertContext";
import { AuthContext } from "../context/AuthContext";

const TeamMembers = () => {
  const toast = useAlert();
  const { adminData } = useContext(AuthContext);

  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(true);

  useEffect(() => {
    setLoading(true);
    getTeamMembers()
      .then((res) => {
        if (res.data.isOk) setEmployees(res.data.data || []);
      })
      .catch(() => toast.error("Failed to load team members"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredEmployees = employees.filter((emp) => {
    if (filter && !emp.isActive) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      emp.employeeName?.toLowerCase().includes(q) ||
      emp.employeeCode?.toLowerCase().includes(q) ||
      emp.roleId?.roleName?.toLowerCase().includes(q) ||
      emp.emailOffice?.toLowerCase().includes(q)
    );
  });

  const myEmployeeId = adminData?._id ? String(adminData._id) : null;

  document.title = `Team Members | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;

  return (
    <React.Fragment>
      <div className="page-content">
        <Container fluid>
          <Row>
            <Col lg={12}>
              {loading && (
                <Card>
                  <CardBody className="text-center text-muted py-5">Loading team members...</CardBody>
                </Card>
              )}

              {!loading && (
                <Card className="mb-3 border-0 bg-transparent shadow-none">
                  <CardBody className="p-0">
                    <FormsModalHeader
                      formName="Team Members"
                      showAddButton={false}
                      setQuery={setQuery}
                      filter={filter}
                      handleFilter={(e) => setFilter(e.target.checked)}
                    />
                  </CardBody>
                </Card>
              )}

              {!loading && filteredEmployees.length === 0 && (
                <Card>
                  <CardBody className="text-center text-muted py-5">
                    No team members found in your hierarchy.
                  </CardBody>
                </Card>
              )}

              {!loading && filteredEmployees.length > 0 && (
                <Card className="mb-3">
                  <CardBody className="p-0">
                    <DataTable
                      columns={[
                        {
                          name: "Name",
                          selector: (row) => row.employeeName,
                          sortable: true,
                          cell: (row) => {
                            const isMe = myEmployeeId && String(row._id) === myEmployeeId;
                            return (
                              <div className="fw-medium">
                                {row.employeeName}
                                {isMe && (
                                  <span className="badge bg-primary-subtle text-primary ms-2">You</span>
                                )}
                              </div>
                            );
                          },
                        },
                        {
                          name: "Role",
                          selector: (row) => row.roleId?.roleName || "Unassigned",
                          sortable: true,
                        },
                        {
                          name: "Email",
                          selector: (row) => row.emailOffice,
                          sortable: true,
                          cell: (row) => row.emailOffice || "—",
                        },
                        {
                          name: "Department",
                          selector: (row) => row.departmentId?.departmentName || "—",
                          sortable: true,
                        },
                        {
                          name: "Status",
                          selector: (row) => row.isActive,
                          sortable: true,
                          maxWidth: "100px",
                          cell: (row) => (
                            <span className={`badge ${row.isActive ? "bg-success-subtle text-success" : "bg-danger-subtle text-danger"}`}>
                              {row.isActive ? "Active" : "Inactive"}
                            </span>
                          ),
                        }
                      ]}
                      data={filteredEmployees}
                      pagination
                      highlightOnHover
                      striped
                      responsive
                      noDataComponent={<div className="p-4 text-muted">No members found.</div>}
                    />
                  </CardBody>
                </Card>
              )}
            </Col>
          </Row>
        </Container>
      </div>
    </React.Fragment>
  );
};

export default TeamMembers;
