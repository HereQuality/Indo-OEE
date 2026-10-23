import React, { useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { getRoleSlug } from '../utils/roleUrl';

// Only the sign-in pages send a logged-in user home. No Access, Blocked and
// Privacy Policy have to show while logged in — No Access is exactly where a
// logged-in user lands when a page is refused, and bouncing it home made the
// refusal silent.
const SIGN_IN_PATHS = ['/', '/login', '/landing'];

const NonAuthLayout = ({ children }) => {
    const { adminData, isSessionVerified } = useContext(AuthContext);
    const { pathname } = useLocation();

    if (!isSessionVerified) return null;

    if (adminData && SIGN_IN_PATHS.includes(pathname.replace(/\/+$/, '') || '/')) {
        const slug = getRoleSlug(adminData) || "operator";
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
