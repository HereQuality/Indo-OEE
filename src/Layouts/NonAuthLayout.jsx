import React, { useContext } from 'react';
import { Navigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { getRoleSlug } from '../utils/roleUrl';

const NonAuthLayout = ({ children }) => {
    const { adminData, isSessionVerified } = useContext(AuthContext);

    if (!isSessionVerified) return null;

    if (adminData) {
        const slug = getRoleSlug(adminData) || "employee";
        const homePath = `/${slug}/home`;
        return <Navigate to={homePath} replace />;
    }

    return (
        <React.Fragment>
            {children}
        </React.Fragment>
    );
};

export default NonAuthLayout;
