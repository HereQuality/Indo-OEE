import React from 'react';

const BreadCrumb = ({ maintitle, title, pageTitle }) => {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 mb-6">
      <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
      <nav className="flex items-center text-sm text-slate-400">
        <span>{maintitle}</span>
        <svg className="w-3.5 h-3.5 mx-1.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-slate-600 font-medium">{pageTitle}</span>
      </nav>
    </div>
  );
};

export default BreadCrumb;