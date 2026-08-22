import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchProfile, setInitialized } from '../../redux/authSlice';

const AuthInitializer = ({ children }) => {
    const dispatch = useDispatch();
    const { isInitialized } = useSelector((state) => state.auth);

    useEffect(() => {
        // Try to restore session on app load
        const initAuth = async () => {
            try {
                await dispatch(fetchProfile()).unwrap();
            } catch {
                // Not authenticated, that's fine
            } finally {
                dispatch(setInitialized());
            }
        };

        if (!isInitialized) {
            initAuth();
        }
    }, [dispatch, isInitialized]);

    return children;
};

export default AuthInitializer;
