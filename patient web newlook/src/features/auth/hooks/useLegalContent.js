import { useState, useCallback } from 'react';
import axiosInstance from '../../../api/axiosConfig';

/**
 * Custom hook to fetch legal content (Terms & Conditions, Privacy Policy)
 */
const useLegalContent = () => {
    const [termsContent, setTermsContent] = useState('');
    const [termsUrl, setTermsUrl] = useState(null);
    const [privacyContent, setPrivacyContent] = useState('');
    const [privacyUrl, setPrivacyUrl] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchTerms = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await axiosInstance.get('/api/legal/terms');
            if (response.data.success) {
                setTermsContent(response.data.content);
                setTermsUrl(response.data.doc_url || null);
            } else {
                setError(response.data.error || 'Failed to load Terms and Conditions');
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load Terms and Conditions');
        } finally {
            setIsLoading(false);
        }
    }, []);

    const fetchPrivacy = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await axiosInstance.get('/api/legal/privacy');
            if (response.data.success) {
                setPrivacyContent(response.data.content);
                setPrivacyUrl(response.data.doc_url || null);
            } else {
                setError(response.data.error || 'Failed to load Privacy Policy');
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load Privacy Policy');
        } finally {
            setIsLoading(false);
        }
    }, []);

    return {
        termsContent,
        termsUrl,
        privacyContent,
        privacyUrl,
        isLoading,
        error,
        fetchTerms,
        fetchPrivacy,
    };
};

export default useLegalContent;
