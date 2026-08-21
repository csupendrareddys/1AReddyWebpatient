/**
 * AuthLanguageContext — provides the selected language to all auth pages
 * rendered inside AuthLayout. This lets individual login pages (AdminLoginPage,
 * ServiceReceiverLoginPage, etc.) pass the correct lang to useLoginPageConfig.
 */
import { createContext, useContext } from 'react';

const AuthLanguageContext = createContext('en');

export const AuthLanguageProvider = AuthLanguageContext.Provider;

export const useAuthLanguage = () => useContext(AuthLanguageContext);

export default AuthLanguageContext;
