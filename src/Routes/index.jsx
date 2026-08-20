import React, { Suspense } from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import RoleRoute, { PageGuard } from "./RoleRoute";
import HomeRedirect from "./HomeRedirect";

// Layouts
import NonAuthLayout from "../Layouts/NonAuthLayout";
import Layout from "../Layouts/Layout";

// Routes
import { protectedRoutes, publicRoutes } from "./allRoutes";

// Every page in allRoutes.jsx is a React.lazy() chunk. The Suspense
// boundary sits around just the page content (inside Layout/NonAuthLayout),
// not around the whole <Routes> tree — otherwise the persistent sidebar/
// header would itself unmount and flash this fallback on every navigation
// instead of just the content pane.
const RouteFallback = () => (
  <div className="flex items-center justify-center w-full h-64">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
  </div>
);

// Layout mounts ONCE per session as the shared parent of every
// "/:roleSlug/..." route — <Outlet/> is where each matched child route's
// element renders. This is deliberately a nested layout route (RoleRoute
// itself renders <Outlet/> too, see RoleRoute.jsx) rather than Layout being
// re-created inside each individual route's `element` — react-router treats
// each top-level <Route element={...}> as its own subtree, so wrapping
// Layout per-route meant it (and everything inside it: the notification
// bell's unread-count poll, useCompany, MenuContext consumers, every page's
// own data hooks) fully unmounted and remounted on EVERY navigation,
// re-firing all of it as a fresh burst of API calls each time. Nesting
// instead means only the <Outlet/> content swaps between pages.
const AppLayout = () => (
  <Layout>
    <Outlet />
  </Layout>
);

const Index = () => {
  return (
    <Routes>
      {publicRoutes.map((route, idx) => (
        <Route
          key={idx}
          path={route.path}
          element={
            <NonAuthLayout>
              <Suspense fallback={<RouteFallback />}>{route.component}</Suspense>
            </NonAuthLayout>
          }
        />
      ))}

      {/* Bare "/home" sends the user to their own "/<roleSlug>/home". */}
      <Route path="/home" element={<HomeRedirect />} />

      {/* Every role — SuperAdmin and every Employee — shares this one
          "/:roleSlug/..." tree, all nested under one persistent Layout.
          Defined once in allRoutes.jsx. */}
      <Route path="/:roleSlug" element={<RoleRoute />}>
        <Route element={<AppLayout />}>
          {protectedRoutes.map((route, idx) => (
            <Route
              key={idx}
              path={route.path.replace(/^\//, "")}
              element={
                <PageGuard allowedRoles={route.roles}>
                  <Suspense fallback={<RouteFallback />}>{route.component}</Suspense>
                </PageGuard>
              }
            />
          ))}
        </Route>
      </Route>
    </Routes>
  );
};

export default Index;
