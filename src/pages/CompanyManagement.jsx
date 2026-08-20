import React, { useState, useEffect } from 'react';
import { getCompanyDetails, updateCompany } from '../api/companies.api';
import { useAlert } from '../context/AlertContext';
import { Card, CardBody, CardHeader, Col, Container, Row, Input, Label, Form, Button, Spinner } from 'reactstrap';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash2, Building2, Globe } from 'lucide-react';
import defaultFavicon from '../assets/Fevicon_hqepl.png';

export default function CompanyManagement() {
  const queryClient = useQueryClient();
  const toast = useAlert();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [companyName, setCompanyName] = useState('');

  // File state
  const [logoFile, setLogoFile] = useState(null);
  const [faviconFile, setFaviconFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [faviconPreview, setFaviconPreview] = useState(null);

  // Current saved URLs from DB (local /uploads URLs)
  const [currentLogo, setCurrentLogo] = useState(null);
  const [currentFavicon, setCurrentFavicon] = useState(null);
  const [originalData, setOriginalData] = useState({ name: '', logo: null, favicon: null });

  // Remove flags — when true, send empty string to server to clear the field
  const [removeLogo, setRemoveLogo] = useState(false);
  const [removeFavicon, setRemoveFavicon] = useState(false);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const res = await getCompanyDetails();
      if (res.data?.isOk && res.data?.data) {
        const { name, logo, favicon } = res.data.data;
        setCompanyName(name || '');
        setCurrentLogo(logo || null);
        setCurrentFavicon(favicon || null);
        setOriginalData({ name: name || '', logo: logo || null, favicon: favicon || null });
      }
    } catch (error) {
      toast.error('Failed to load company settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleFileChange = (e, type) => {
    const file = e.target.files[0];
    if (!file) return;

    if (type === 'logo') {
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
      setRemoveLogo(false);
    } else {
      setFaviconFile(file);
      setFaviconPreview(URL.createObjectURL(file));
      setRemoveFavicon(false);
    }
  };

  const handleRemove = (type) => {
    if (type === 'logo') {
      setLogoFile(null);
      setLogoPreview(null);
      setRemoveLogo(true);
    } else {
      setFaviconFile(null);
      setFaviconPreview(null);
      setRemoveFavicon(true);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!companyName.trim()) {
      toast.error('Company name is required');
      return;
    }
    try {
      setSaving(true);
      const data = new FormData();
      data.append('name', companyName.trim());

      if (logoFile) {
        data.append('logo', logoFile);
      } else if (removeLogo) {
        data.append('removeLogo', 'true');
      }

      if (faviconFile) {
        data.append('favicon', faviconFile);
      } else if (removeFavicon) {
        data.append('removeFavicon', 'true');
      }

      const res = await updateCompany(data);

      if (res.data?.status === 'success' || res.data?.isOk) {
        queryClient.invalidateQueries({ queryKey: ['companyDetails'] });
        toast.success('Settings saved successfully!');
        // Reset file states and refetch
        setLogoFile(null);
        setFaviconFile(null);
        setLogoPreview(null);
        setFaviconPreview(null);
        setRemoveLogo(false);
        setRemoveFavicon(false);
        fetchSettings();
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  document.title = `Company Settings | ${window.localStorage.getItem('companyName') || import.meta.env.VITE_APP_NAME}`;

  // Determine what to display for each image slot
  const logoDisplay = logoPreview || (removeLogo ? null : currentLogo);
  const faviconDisplay = faviconPreview || (removeFavicon ? null : currentFavicon);

  const isChanged = 
    companyName !== originalData.name ||
    logoFile !== null || removeLogo ||
    faviconFile !== null || removeFavicon;

  return (
    <React.Fragment>
      <div className="page-content">
        <Container fluid>
          <Row>
            <Col lg={8} className="mx-auto">
              <Card>
                <CardHeader>
                  <div className="d-flex align-items-center gap-2">
                    <Building2 size={20} />
                    <h5 className="mb-0">Company Settings</h5>
                  </div>
                </CardHeader>
                <CardBody>
                  {loading ? (
                    <div>
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="mb-4">
                          <div className="cm-skel mb-2" style={{ width: 120, height: 10 }} />
                          <div className="cm-skel" style={{ width: "100%", height: 38, borderRadius: 8 }} />
                        </div>
                      ))}
                      <style>{`
                        @keyframes cm-shimmer { 0% { background-position: -200px 0; } 100% { background-position: calc(200px + 100%) 0; } }
                        .cm-skel {
                          background: linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 37%, #e5e7eb 63%);
                          background-size: 400px 100%;
                          animation: cm-shimmer 1.4s ease-in-out infinite;
                          border-radius: 6px;
                        }
                      `}</style>
                    </div>
                  ) : (
                    <Form onSubmit={handleSubmit}>
                      {/* Company Name */}
                      <div className="mb-4">
                        <Label className="fw-semibold">Company Name <span className="text-danger">*</span></Label>
                        <Input
                          type="text"
                          placeholder="e.g. HQEPL"
                          value={companyName}
                          onChange={(e) => setCompanyName(e.target.value)}
                          required
                        />
                      </div>

                      <Row>
                        {/* Logo Upload */}
                        <Col md={6}>
                          <div className="mb-4">
                            <Label className="fw-semibold">Company Logo</Label>
                            <p className="text-muted small mb-2">Recommended: PNG/SVG, max 2MB. Will be saved as WebP.</p>

                            {logoDisplay ? (
                              <div className="border rounded p-3 d-flex align-items-center gap-3" style={{ background: 'var(--vz-secondary-bg)' }}>
                                <img
                                  src={logoDisplay}
                                  alt="Logo"
                                  style={{ height: 56, maxWidth: 140, objectFit: 'contain', borderRadius: 6 }}
                                />
                                <div className="d-flex flex-column gap-2">
                                  <label className="btn btn-sm btn-outline-primary mb-0" style={{ cursor: 'pointer' }}>
                                    <ImagePlus size={14} className="me-1" /> Change
                                    <input type="file" accept="image/*" className="d-none" onChange={(e) => handleFileChange(e, 'logo')} />
                                  </label>
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-soft-danger"
                                    onClick={() => handleRemove('logo')}
                                  >
                                    <Trash2 size={14} className="me-1" /> Remove
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <label className="border rounded p-4 d-flex flex-column align-items-center justify-content-center gap-2 w-100"
                                style={{ cursor: 'pointer', borderStyle: 'dashed', background: 'var(--vz-secondary-bg)', minHeight: 100 }}>
                                <ImagePlus size={28} className="text-muted" />
                                <span className="text-muted small">Click to upload logo</span>
                                <input type="file" accept="image/*" className="d-none" onChange={(e) => handleFileChange(e, 'logo')} />
                              </label>
                            )}
                          </div>
                        </Col>

                        {/* Favicon Upload */}
                        <Col md={6}>
                          <div className="mb-4">
                            <Label className="fw-semibold d-flex align-items-center">
                              <Globe size={14} className="me-1" />Favicon
                            </Label>
                            <p className="text-muted small mb-2">Recommended: ICO/PNG, max 2MB. Shown in browser tab.</p>

                            {faviconDisplay ? (
                              <div className="border rounded p-3 d-flex align-items-center gap-3" style={{ background: 'var(--vz-secondary-bg)' }}>
                                <img
                                  src={faviconDisplay}
                                  alt="Favicon"
                                  style={{ height: 48, width: 48, objectFit: 'contain', borderRadius: 6 }}
                                />
                                <div className="d-flex flex-column gap-2">
                                  <label className="btn btn-sm btn-outline-primary mb-0" style={{ cursor: 'pointer' }}>
                                    <ImagePlus size={14} className="me-1" /> Change
                                    <input type="file" accept="image/*" className="d-none" onChange={(e) => handleFileChange(e, 'favicon')} />
                                  </label>
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-soft-danger"
                                    onClick={() => handleRemove('favicon')}
                                  >
                                    <Trash2 size={14} className="me-1" /> Remove
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <label className="border rounded p-4 d-flex flex-column align-items-center justify-content-center gap-2 w-100"
                                style={{ cursor: 'pointer', borderStyle: 'dashed', background: 'var(--vz-secondary-bg)', minHeight: 100 }}>
                                <img src={defaultFavicon} alt="Default" style={{ height: 32, opacity: 0.4 }} />
                                <span className="text-muted small">Click to upload favicon</span>
                                <input type="file" accept="image/*" className="d-none" onChange={(e) => handleFileChange(e, 'favicon')} />
                              </label>
                            )}
                          </div>
                        </Col>
                      </Row>

                      <div className="text-end mt-2">
                        <Button color="primary" type="submit" disabled={saving || !isChanged} className="px-4" style={{ opacity: (!isChanged && !saving) ? 0.6 : 1 }}>
                          {saving ? <><Spinner size="sm" className="me-1" /> Saving...</> : 'Save Settings'}
                        </Button>
                      </div>
                    </Form>
                  )}
                </CardBody>
              </Card>
            </Col>
          </Row>
        </Container>
      </div>
    </React.Fragment>
  );
}