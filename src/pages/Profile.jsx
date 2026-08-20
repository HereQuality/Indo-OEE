import React, { useContext, useState, useEffect, useRef, useCallback } from "react";
import { AuthContext } from "../context/AuthContext";
import { useAlert } from "../context/AlertContext";
import { updateProfile, changePassword, checkUsernameAvailability } from "../api/auth.api";
import ConfirmAlert from "../Components/Common/ConfirmAlert";

// ── Shared icon components ────────────────────────────────────────────────────
function IconEye(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function IconEyeOff(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c6.2 0 10 7 10 7a15.6 15.6 0 0 1-4.2 4.9M6.6 6.6C3.9 8.3 2 12 2 12s3.8 7 10 7c1.4 0 2.7-.3 3.9-.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

// ── Field wrapper ─────────────────────────────────────────────────────────────
const Field = ({ label, optional, children }) => (
  <div className="mb-4">
    <label className="block text-sm font-medium text-slate-700 mb-1">
      {label}
      {optional && <span className="ml-1 text-xs text-slate-400">(optional)</span>}
    </label>
    {children}
  </div>
);

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500";
const readOnlyClass =
  "w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500";

// ── Password field with eye toggle ────────────────────────────────────────────
function PasswordField({ name, value, onChange, placeholder = "••••••••", ...rest }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`${inputClass} pr-10`}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
      >
        {show
          ? <IconEyeOff className="h-4 w-4" />
          : <IconEye className="h-4 w-4" />}
      </button>
    </div>
  );
}

// ── Username availability badge ───────────────────────────────────────────────
function UsernameAvailability({ username, currentUsername }) {
  const [state, setState] = useState('idle'); // idle | checking | available | taken | short
  const timerRef = useRef(null);

  useEffect(() => {
    if (!username || username === currentUsername) {
      setState('idle');
      return;
    }
    if (username.length < 3) {
      setState('short');
      return;
    }
    setState('checking');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const available = await checkUsernameAvailability(username);
      setState(available ? 'available' : 'taken');
    }, 400);
    return () => clearTimeout(timerRef.current);
  }, [username, currentUsername]);

  if (state === 'idle') return null;

  const map = {
    checking:  { text: 'Checking…', cls: 'text-slate-500' },
    available: { text: '✓ Username available', cls: 'text-green-600' },
    taken:     { text: '✗ Username already taken', cls: 'text-red-500' },
    short:     { text: 'Min. 3 characters', cls: 'text-slate-400' },
  };
  const { text, cls } = map[state];
  return <p className={`mt-1 text-xs font-medium ${cls}`}>{text}</p>;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Profile() {
  const { adminData, setAdminData } = useContext(AuthContext);
  const toast = useAlert();
  const isSuperAdmin = adminData?.roleType === "SuperAdmin";

  // ── Profile details form ─────────────────────────────────────────────────
  const [form, setForm] = useState({
    // SuperAdmin fields
    name:         adminData?.name || "",
    username:     adminData?.username || "",
    // Employee fields
    employeeName: adminData?.employeeName || adminData?.name || "",
    mobileNumber: adminData?.mobileNumber || "",
    emailOffice:  adminData?.emailOffice || "",
    address:      adminData?.address || "",
  });
  const [profilePic, setProfilePic] = useState(null);
  const [profilePicPreview, setProfilePicPreview] = useState(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [isRemovingPic, setIsRemovingPic] = useState(false);
  const [removeAlert, setRemoveAlert] = useState(false);

  const isProfileChanged = 
    form.name !== (adminData?.name || "") ||
    form.username !== (adminData?.username || "") ||
    form.employeeName !== (adminData?.employeeName || adminData?.name || "") ||
    form.mobileNumber !== (adminData?.mobileNumber || "") ||
    form.emailOffice !== (adminData?.emailOffice || "") ||
    form.address !== (adminData?.address || "") ||
    profilePic !== null;

  const triggerRemovePicture = () => {
    // If they just selected a new picture locally and haven't saved, just clear the local state
    if (profilePicPreview) {
      setProfilePic(null);
      setProfilePicPreview(null);
      return;
    }
    setRemoveAlert(true);
  };

  const executeRemovePicture = async () => {
    setRemoveAlert(false);
    setIsRemovingPic(true);
    try {
      const formData = new FormData();
      formData.append("removeProfilePic", "true");
      const res = await updateProfile(formData);
      if (res.data.isOk) {
        setAdminData(res.data.data);
        setProfilePic(null);
        setProfilePicPreview(null);
        toast.success("Profile picture removed successfully");
      } else {
        toast.error(res.data.message || "Failed to remove profile picture");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to remove profile picture");
    } finally {
      setIsRemovingPic(false);
    }
  };

  const handleProfileChange = (e) => {
    let { name, value } = e.target;
    
    // Restrict username input: only lowercase letters, numbers, _, @, -
    if (name === "username") {
      value = value.toLowerCase().replace(/[^a-z0-9_@-]/g, "");
    }
    
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const payload = isSuperAdmin
        ? { name: form.name, username: form.username || undefined }
        : {
            employeeName: form.employeeName,
            mobileNumber: form.mobileNumber,
            emailOffice:  form.emailOffice || undefined,
            username:     form.username || undefined,
            address:      form.address || undefined,
          };
      
      const formData = new FormData();
      Object.keys(payload).forEach(key => {
        if (payload[key] !== undefined) formData.append(key, payload[key]);
      });
      if (profilePic) {
        formData.append("profilePic", profilePic);
      }

      const res = await updateProfile(formData);
      if (res.data.isOk) {
        setAdminData(res.data.data);
        toast.success("Profile updated successfully");
      } else {
        toast.error(res.data.message || "Failed to update profile");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update profile");
    } finally {
      setSavingProfile(false);
    }
  };

  // ── Change password form ─────────────────────────────────────────────────
  const [pwForm, setPwForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [savingPassword, setSavingPassword] = useState(false);

  const handlePwChange = (e) => {
    setPwForm({ ...pwForm, [e.target.name]: e.target.value });
  };

  const handlePwSubmit = async (e) => {
    e.preventDefault();
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      toast.error("New password and confirmation don't match.");
      return;
    }
    if (pwForm.newPassword.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(pwForm.newPassword)) {
      toast.error("Password must contain at least one uppercase letter, one lowercase letter, and one number.");
      return;
    }
    setSavingPassword(true);
    try {
      const res = await changePassword({
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      });
      if (res.data.isOk) {
        toast.success("Password changed successfully");
        setPwForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      } else {
        toast.error(res.data.message || "Failed to change password");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to change password");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <ConfirmAlert
        isOpen={removeAlert}
        variant="danger"
        title="Remove Profile Picture?"
        message="Are you sure you want to remove your profile picture? This action cannot be undone and takes effect immediately."
        confirmText="Yes, Remove"
        cancelText="Cancel"
        onCancel={() => setRemoveAlert(false)}
        onConfirm={executeRemovePicture}
      />
      <div>
        <h1 className="text-xl font-bold text-slate-900">Edit Profile</h1>
        <p className="text-sm text-slate-500 mt-1">Update your details and password.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* ── Left Sidebar: Profile Summary ──────────────────────────── */}
        <div className="md:col-span-1">
          <div className="bg-white/40 backdrop-blur-md rounded-2xl border border-white/50 shadow-[0_8px_32px_0_rgba(31,38,135,0.07)] p-6 text-center">
            <div className="mx-auto h-24 w-24 rounded-full overflow-hidden bg-slate-100 flex items-center justify-center mb-4 border border-white/60 relative group shadow-sm">
              {(profilePicPreview || adminData?.profilePic) ? (
                <img src={profilePicPreview || adminData.profilePic} alt="Profile" className="h-full w-full object-cover" />
              ) : (
                <span className="text-3xl font-bold text-slate-400">
                  {adminData?.employeeName ? adminData.employeeName.substring(0,2).toUpperCase() : (adminData?.name ? adminData.name.substring(0,2).toUpperCase() : "U")}
                </span>
              )}
              {/* Overlay for uploading */}
              <label className="absolute inset-0 bg-black/50 hidden group-hover:flex items-center justify-center cursor-pointer transition-opacity">
                <span className="text-white text-xs font-semibold">Change</span>
                <input 
                  type="file" 
                  className="hidden" 
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files[0];
                    if (file) {
                      if (file.size > 2 * 1024 * 1024) {
                        toast.error("Profile picture must be less than 2MB");
                        // clear the input
                        e.target.value = null;
                        return;
                      }
                      setProfilePic(file);
                      setProfilePicPreview(URL.createObjectURL(file));
                    }
                  }}
                />
              </label>
            </div>
            {(adminData?.profilePic || profilePicPreview) && (
              <button 
                type="button" 
                onClick={triggerRemovePicture}
                disabled={isRemovingPic}
                className="text-xs text-red-500 hover:text-red-700 font-medium mb-4 block mx-auto disabled:opacity-50"
              >
                {isRemovingPic ? "Removing..." : "Remove Picture"}
              </button>
            )}
            <h2 className="text-lg font-bold text-slate-900">{adminData?.employeeName || adminData?.name || "User"}</h2>
            <p className="text-sm text-brand-600 font-medium mb-4">{adminData?.roleName || "No Role"}</p>
            
            {!isSuperAdmin && (
              <div className="text-left space-y-4 border-t border-slate-200/50 pt-5 mt-4">
                {adminData?.departmentIds && adminData.departmentIds.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Departments</p>
                    <p className="text-sm font-medium text-slate-700">
                      {adminData.departmentIds.map(d => d.departmentName).join(", ")}
                    </p>
                  </div>
                )}
                {adminData?.skills && adminData.skills.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Skills</p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {adminData.skills.map((s, idx) => (
                        <span key={idx} className="bg-brand-50/80 text-brand-700 text-xs px-2.5 py-0.5 rounded-full border border-brand-100/50">
                          {s.label || s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {adminData?.joiningDate && (
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Joining Date</p>
                    <p className="text-sm font-medium text-slate-700">
                      {new Date(adminData.joiningDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                  </div>
                )}

                {adminData.remark && (
                  <div>
                    <h3 className="text-[10px] font-bold text-white/50 uppercase tracking-wider mb-1">Remark</h3>
                    <p className="text-sm text-white/90">
                      {adminData.remark}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Right Content: Editing Forms ───────────────────────────── */}
        <div className="md:col-span-2 space-y-6">

      {/* ── Profile details ──────────────────────────────────────────── */}
      <form onSubmit={handleProfileSubmit} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Profile Details</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">

          {isSuperAdmin ? (
            <>
              <Field label="Full Name">
                <input
                  type="text"
                  name="name"
                  value={form.name}
                  onChange={handleProfileChange}
                  placeholder="Your full name"
                  className={inputClass}
                  required
                />
              </Field>

              <Field label="Email">
                <input
                  type="text"
                  value={adminData?.email || ""}
                  disabled
                  className={readOnlyClass}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="Full Name">
                <input
                  type="text"
                  name="employeeName"
                  value={form.employeeName}
                  onChange={handleProfileChange}
                  placeholder="Your full name"
                  className={inputClass}
                  required
                />
              </Field>

              <Field label="Role">
                <input
                  type="text"
                  value={adminData?.roleName || "—"}
                  disabled
                  className={readOnlyClass}
                />
              </Field>

              <Field label="Mobile Number" optional>
                <input
                  type="text"
                  name="mobileNumber"
                  value={form.mobileNumber}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 10);
                    setForm((prev) => ({ ...prev, mobileNumber: v }));
                  }}
                  placeholder="10-digit mobile number"
                  className={inputClass}
                  maxLength="10"
                  inputMode="numeric"
                />
              </Field>

              <Field label="Office Email" optional>
                <input
                  type="email"
                  name="emailOffice"
                  value={form.emailOffice}
                  onChange={handleProfileChange}
                  placeholder="you@company.com"
                  className={inputClass}
                  maxLength="30"
                />
              </Field>

              <div className="sm:col-span-2">
                <Field label="Address" optional>
                  <textarea
                    name="address"
                    value={form.address}
                    onChange={handleProfileChange}
                    placeholder="Enter your address..."
                    className={inputClass}
                    rows="2"
                    maxLength="150"
                  />
                </Field>
              </div>
            </>
          )}

          {/* Username — editable for both roles */}
          <div className="sm:col-span-2">
            <Field label="Username">
              <input
                type="text"
                name="username"
                value={form.username}
                onChange={handleProfileChange}
                placeholder="your.username"
                autoComplete="username"
                className={inputClass}
              />
              <UsernameAvailability
                username={form.username}
                currentUsername={adminData?.username}
              />
              <p className="mt-1 text-xs text-slate-400">
                Your username is visible to admins and team members. Only lowercase letters, numbers, and <code className="px-1 bg-slate-100 rounded">_ @ -</code> are allowed.
              </p>
            </Field>
          </div>

        </div>

        <button
          type="submit"
          disabled={savingProfile || !isProfileChanged || (isSuperAdmin ? !form.name : !form.employeeName) || (form.username && form.username.length > 0 && form.username.length < 3)}
          className={`mt-2 text-sm font-medium px-5 py-2.5 rounded-lg transition-colors text-white ${
            (savingProfile || !isProfileChanged || (isSuperAdmin ? !form.name : !form.employeeName) || (form.username && form.username.length > 0 && form.username.length < 3))
              ? "bg-slate-300 cursor-not-allowed"
              : "bg-brand-600 hover:bg-brand-700 shadow-sm"
          }`}
        >
          {savingProfile ? "Saving…" : "Save Changes"}
        </button>
      </form>

      {/* ── Change password ──────────────────────────────────────────── */}
      <form onSubmit={handlePwSubmit} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Change Password</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          <Field label="Current Password">
            <PasswordField
              name="currentPassword"
              value={pwForm.currentPassword}
              onChange={handlePwChange}
              placeholder="Current password"
              required
            />
          </Field>
          <div className="hidden sm:block" />

          <Field label="New Password">
            <PasswordField
              name="newPassword"
              value={pwForm.newPassword}
              onChange={handlePwChange}
              placeholder="Min. 8 characters"
              minLength={8}
              required
            />
            <p className="mt-1 text-[10px] text-red-700 leading-tight">
              Must include at least 1 uppercase letter, 1 lowercase letter, and 1 number.
            </p>
          </Field>

          <Field label="Confirm New Password">
            <PasswordField
              name="confirmPassword"
              value={pwForm.confirmPassword}
              onChange={handlePwChange}
              placeholder="Repeat new password"
              minLength={8}
              required
            />
          </Field>
        </div>

        <button
          type="submit"
          disabled={savingPassword || !pwForm.currentPassword || pwForm.newPassword.length < 8 || pwForm.newPassword !== pwForm.confirmPassword}
          className={`mt-1 text-sm font-medium px-5 py-2.5 rounded-lg transition-colors text-white ${
            (savingPassword || !pwForm.currentPassword || pwForm.newPassword.length < 8 || pwForm.newPassword !== pwForm.confirmPassword)
              ? "bg-slate-300 cursor-not-allowed"
              : "bg-brand-600 hover:bg-brand-700 shadow-sm"
          }`}
        >
          {savingPassword ? "Changing…" : "Change Password"}
        </button>
      </form>
        </div>
      </div>
    </div>
  );
}
