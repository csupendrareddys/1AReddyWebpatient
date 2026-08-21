import { useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    Box,
    CircularProgress,
    IconButton,
    Link,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import useLegalContent from '../../hooks/useLegalContent';

/**
 * Renders text with links highlighted and clickable
 */
const renderTextWithLinks = (text) => {
    if (!text) return null;

    // Pattern to match URLs and email addresses
    const linkPattern = /(https?:\/\/[^\s\)]+|www\.[^\s\)]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

    const parts = text.split(linkPattern);

    return parts.map((part, index) => {
        // Check if this part matches the link pattern
        if (part && linkPattern.test(part)) {
            linkPattern.lastIndex = 0; // Reset regex
            const href = part.startsWith('http') ? part :
                part.includes('@') ? `mailto:${part}` : `https://${part}`;
            return (
                <Link
                    key={index}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                        color: 'primary.main',
                        textDecoration: 'underline',
                        '&:hover': {
                            color: 'primary.dark',
                        },
                    }}
                >
                    {part}
                </Link>
            );
        }
        return part;
    });
};

/**
 * Modal component to display Terms & Conditions or Privacy Policy content
 */
const LegalContentModal = ({ open, onClose, type }) => {
    const { termsContent, termsUrl, privacyContent, privacyUrl, isLoading, error, fetchTerms, fetchPrivacy } = useLegalContent();

    const title = type === 'terms' ? 'Terms and Conditions' : 'Privacy Policy';
    const content = type === 'terms' ? termsContent : privacyContent;
    const docUrl = type === 'terms' ? termsUrl : privacyUrl;

    useEffect(() => {
        if (open) {
            if (type === 'terms' && !termsContent) {
                fetchTerms();
            } else if (type === 'privacy' && !privacyContent) {
                fetchPrivacy();
            }
        }
    }, [open, type, termsContent, privacyContent, fetchTerms, fetchPrivacy]);

    const renderContent = () => {
        if (!content) return null;

        const lines = content.split('\n');

        return lines.map((line, index) => {
            const trimmedLine = line.trim();

            // Empty lines - add spacing
            if (trimmedLine === '') {
                return <Box key={index} sx={{ height: 12 }} />;
            }

            // Check if line is a main heading (starts with title-like text)
            const isMainTitle = index === 0 ||
                trimmedLine.match(/^(JLMUSH|Privacy Policy|Terms and Conditions)/i);

            // Check if line starts with section markers
            const isMainSection = trimmedLine.startsWith('•');
            const isSubSection = trimmedLine.startsWith('o ');
            const isPoint = trimmedLine.startsWith('§');

            // Determine indentation based on content structure
            let paddingLeft = 0;
            let fontWeight = 'normal';
            let fontSize = 'body2';
            let marginBottom = 0.5;
            let marginTop = 0;

            if (isMainTitle && index === 0) {
                fontSize = 'h5';
                fontWeight = 'bold';
                marginBottom = 2;
            } else if (isMainSection) {
                fontWeight = 'bold';
                fontSize = 'body1';
                marginTop = 2;
                marginBottom = 1;
            } else if (isSubSection) {
                paddingLeft = 2;
                fontWeight = 600;
                marginTop = 1.5;
            } else if (isPoint) {
                paddingLeft = 3;
            } else if (trimmedLine.match(/^(i{1,3}|iv|v|vi{1,3}|ix|x)\.\s/i) ||
                trimmedLine.match(/^[a-f]\.\s/i)) {
                // Roman numerals or letter lists
                paddingLeft = 4;
            } else if (trimmedLine.match(/^\d+\.\s/)) {
                // Numbered items
                paddingLeft = 2;
            }

            return (
                <Typography
                    key={index}
                    variant={fontSize}
                    component="div"
                    sx={{
                        pl: paddingLeft,
                        fontWeight: fontWeight,
                        mb: marginBottom,
                        mt: marginTop,
                        lineHeight: 1.7,
                        whiteSpace: 'pre-wrap',
                    }}
                >
                    {renderTextWithLinks(line)}
                </Typography>
            );
        });
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="md"
            fullWidth
            scroll="paper"
            aria-labelledby="legal-content-dialog-title"
            PaperProps={{
                sx: { maxHeight: '85vh' },
            }}
        >
            <DialogTitle
                id="legal-content-dialog-title"
                sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: 1,
                    borderColor: 'divider',
                }}
            >
                <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
                    {title}
                </Typography>
                <IconButton
                    aria-label="close"
                    onClick={onClose}
                    sx={{ color: 'text.secondary' }}
                >
                    <CloseIcon />
                </IconButton>
            </DialogTitle>
            <DialogContent dividers sx={{ p: 3 }}>
                {isLoading ? (
                    <Box
                        sx={{
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            minHeight: 200,
                        }}
                    >
                        <CircularProgress />
                    </Box>
                ) : error ? (
                    <Box sx={{ textAlign: 'center', py: 4 }}>
                        <Typography color="error">{error}</Typography>
                    </Box>
                ) : (
                    <Box sx={{ minHeight: docUrl ? 150 : 'auto' }}>
                        {docUrl ? (
                            <Box sx={{ textAlign: 'center', py: 4 }}>
                                <Typography variant="body1" sx={{ mb: 3 }}>
                                    Click below to view the {title} document:
                                </Typography>
                                <Button
                                    variant="contained"
                                    size="large"
                                    href={docUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    View {title} (PDF)
                                </Button>
                            </Box>
                        ) : (
                            renderContent()
                        )}
                    </Box>
                )}
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2, borderTop: 1, borderColor: 'divider' }}>
                <Button onClick={onClose} variant="contained">
                    Close
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default LegalContentModal;
