import React, { useEffect } from "react";
import { useCompany } from "./hooks/useCompany";
import defaultFavicon from "./assets/Fevicon_hqepl.png";
const API_URL = import.meta.env.VITE_API_BASE_URL;

// Import Main Routes
import Route from "./Routes";

import "./index.css";

function App() {
  const { data: companyDetails } = useCompany();

  useEffect(() => {
    if (companyDetails) {
      const { name, favicon } = companyDetails;

      if (name) {
        // Dynamically update the suffix of the current document title
        const titleParts = document.title.split(' | ');
        if (titleParts.length > 0) {
          document.title = `${titleParts[0]} | ${name}`;
        } else {
          document.title = name;
        }
      }

      // Update favicon: use company-uploaded favicon or fall back to default
      let link = document.querySelector("link[rel~='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = favicon ? favicon : defaultFavicon;
    }
  }, [companyDetails]);

  return (
    <React.Fragment>
      <Route />
    </React.Fragment>
  );
}

export default App;