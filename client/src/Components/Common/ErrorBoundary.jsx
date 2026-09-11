import React from "react";

// Top-level safety net. Without this, ANY render error thrown anywhere in
// the tree — including a lazy-loaded route chunk failing to import — would
// unmount the entire app with no visible error, no chrome, nothing: just a
// blank screen. React only stops that if something above the error catches
// it, and nothing else in this app does.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Unhandled render error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center w-full h-screen gap-4 bg-white dark:bg-[#0f0f0f] px-6 text-center">
          <p className="text-base font-semibold text-slate-800 dark:text-slate-100">Something went wrong loading this page.</p>
          <p className="text-sm text-slate-500 max-w-sm">
            This can happen after an app update. Reloading usually fixes it.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-5 py-2 shadow-sm transition-colors"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
