// RedirectToJoinWithVertical.jsx
// Catches old-style /join/:vertical links and 301s them (client-side)
// to the new single-page /join?vertical=:vertical shape.
//
// Passes the vertical through unchecked — it used to validate against its own
// hardcoded doctor/clinic/hospital list, but the valid set is the backend's
// vertical types now, and /join already resolves an unknown code to its first
// tab. Re-checking here would mean a second copy of the list to drift.
import { Navigate, useParams } from 'react-router-dom';

export default function RedirectToJoinWithVertical() {
    const { vertical } = useParams();

    return <Navigate to={`/join?vertical=${encodeURIComponent(vertical || '')}`} replace />;
}
