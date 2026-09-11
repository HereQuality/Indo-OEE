import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../../context/AuthContext';
import { useDebounce } from '../../hooks/useDebounce';

const FormsHeader = ({ 
  formName, filter, handleFilter, tog_list, setQuery, showAddButton = true,
  showForm = false, updateForm = false, handleSave, handleCancel, isSaveDisabled, isLoading, formId
}) => {
  const { adminData } = useContext(AuthContext);
  const [localSearch, setLocalSearch] = useState('');
  const debouncedSearch = useDebounce(localSearch, 300);

  useEffect(() => {
    setQuery(debouncedSearch);
  }, [debouncedSearch, setQuery]);

  const handleSearchChange = (e) => {
    setLocalSearch(e.target.value);
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
      {showAddButton && !showForm && !updateForm && (
        <button
          type="button"
          onClick={tog_list}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2.5 shadow-sm transition-colors shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add {formName}
        </button>
      )}

      {(showForm || updateForm) && (
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isLoading}
            className="rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2.5 transition-colors disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            onClick={!formId ? handleSave : undefined}
            disabled={isSaveDisabled || isLoading}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2.5 shadow-sm transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Saving...
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 sm:ml-auto w-full sm:w-auto">
        <input
          type="text"
          placeholder="Search..."
          onChange={handleSearchChange}
          className="w-full sm:w-56 bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 transition-all placeholder:text-slate-400 text-slate-800"
        />

        {adminData?.roleType === 'SuperAdmin' && typeof filter === 'string' ? (
          <select
            value={filter}
            onChange={handleFilter}
            className="w-full sm:w-40 bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 transition-all text-slate-700"
          >
            <option value="All">All Status</option>
            <option value="Active">Active Only</option>
            <option value="Inactive">Inactive Only</option>
          </select>
        ) : adminData?.roleType === 'SuperAdmin' && (
          <label className="inline-flex items-center gap-2 shrink-0 cursor-pointer select-none" title="Show Active Only">
            <span className="text-xs font-medium text-slate-500 whitespace-nowrap hidden sm:inline">
              Active only
            </span>
            <span className="relative inline-flex">
              <input
                type="checkbox"
                checked={filter}
                onChange={handleFilter}
                className="peer sr-only"
              />
              <span className="block h-6 w-11 rounded-full bg-slate-300 peer-checked:bg-brand-600 transition-colors"></span>
              <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"></span>
            </span>
          </label>
        )}
      </div>
    </div>
  );
};

export default FormsHeader;