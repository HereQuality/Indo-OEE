import React, { useContext } from "react";
import { Container, Card, CardBody, CardHeader, Row, Col } from "reactstrap";
import { ThemeContext } from "../context/ThemeContext";
import { AuthContext } from "../context/AuthContext";

const Settings = () => {
  const { isDarkMode, toggleTheme } = useContext(ThemeContext);
  const { adminData, updatePreferences } = useContext(AuthContext);

  const showDashboardClock = adminData?.preferences?.showDashboardClock !== false;

  const toggleClock = () => {
    if (updatePreferences) {
      updatePreferences({ showDashboardClock: !showDashboardClock });
    }
  };

  document.title = `Settings | ${window.localStorage.getItem('companyName') || import.meta.env.VITE_APP_NAME}`;

  return (
    <React.Fragment>
      <div className="page-content">
        <Container fluid>

          <Row>
            <Col lg={12}>
              <Card>
                <CardHeader>
                  <h4 className="card-title mb-0 flex-grow-1">Appearance</h4>
                </CardHeader>
                <CardBody>
                  <div className="d-flex align-items-center justify-content-between p-3 border rounded">
                    <div>
                      <h6 className="mb-1">Theme Mode</h6>
                      <p className="text-muted mb-0">Toggle between Light and Dark mode.</p>
                    </div>
                    <div className="form-check form-switch form-switch-lg form-switch-success mb-0" dir="ltr">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        id="customSwitchsizelg"
                        checked={isDarkMode}
                        onChange={toggleTheme}
                      />
                      <label className="form-check-label" htmlFor="customSwitchsizelg"></label>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </Col>
          </Row>

          <Row>
            <Col lg={12}>
              <Card>
                <CardHeader>
                  <h4 className="card-title mb-0 flex-grow-1">Dashboard Preferences</h4>
                </CardHeader>
                <CardBody>
                  <div className="d-flex align-items-center justify-content-between p-3 border rounded">
                    <div>
                      <h6 className="mb-1">Real-Time Clock</h6>
                      <p className="text-muted mb-0">Show or hide the real-time clock on your dashboard.</p>
                    </div>
                    <div className="form-check form-switch form-switch-lg form-switch-success mb-0" dir="ltr">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        id="clockSwitchsizelg"
                        checked={showDashboardClock}
                        onChange={toggleClock}
                      />
                      <label className="form-check-label" htmlFor="clockSwitchsizelg"></label>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </Col>
          </Row>
        </Container>
      </div>
    </React.Fragment>
  );
};

export default Settings;
