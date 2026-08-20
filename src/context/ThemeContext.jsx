import React, { createContext, useState, useEffect, useContext } from "react";
import { AuthContext } from "./AuthContext";

export const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const { adminData, updatePreferences } = useContext(AuthContext);

  const [isDarkMode, setIsDarkMode] = useState(() => {
    const savedTheme = localStorage.getItem("theme");
    return savedTheme === "dark";
  });

  useEffect(() => {
    if (adminData && adminData.preferences && adminData.preferences.themeMode) {
      setIsDarkMode(adminData.preferences.themeMode === "dark");
    }
  }, [adminData?.preferences?.themeMode]);

  useEffect(() => {
    const root = window.document.documentElement;

    if (isDarkMode) {
      root.classList.add("dark");
      root.setAttribute("data-bs-theme", "dark");
      window.document.body.setAttribute("data-bs-theme", "dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      root.removeAttribute("data-bs-theme");
      window.document.body.removeAttribute("data-bs-theme");
      localStorage.setItem("theme", "light");
    }
  }, [isDarkMode]);

  const toggleTheme = () => {
    setIsDarkMode((prevMode) => {
      const newMode = !prevMode;
      if (adminData && updatePreferences) {
        updatePreferences({ themeMode: newMode ? 'dark' : 'light' });
      }
      return newMode;
    });
  };

  return (
    <ThemeContext.Provider value={{ isDarkMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
