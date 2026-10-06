import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { hasActiveAccessToken, normalizeAuthReturnPath } from '../utils/authSession';

export default function RequireAuth() {
  const location = useLocation();

  if (!hasActiveAccessToken()) {
    const from = normalizeAuthReturnPath(
      `${location.pathname}${location.search}${location.hash}`
    );
    return <Navigate to="/login" replace state={{ from }} />;
  }

  return <Outlet />;
}
