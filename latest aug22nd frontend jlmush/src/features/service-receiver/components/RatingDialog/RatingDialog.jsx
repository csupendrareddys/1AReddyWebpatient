import { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
    Rating,
    TextField,
    FormControlLabel,
    Checkbox,
    CircularProgress,
    Alert,
} from '@mui/material';
import StarIcon from '@mui/icons-material/Star';

const labels = {
    1: 'Poor',
    2: 'Fair',
    3: 'Good',
    4: 'Very Good',
    5: 'Excellent',
};

const RatingDialog = ({ open, onClose, onSubmit, loading = false, error = null }) => {
    const [rating, setRating] = useState(0);
    const [hover, setHover] = useState(-1);
    const [review, setReview] = useState('');
    const [isAnonymous, setIsAnonymous] = useState(false);

    const handleSubmit = () => {
        if (rating > 0) {
            onSubmit(rating, review, isAnonymous);
        }
    };

    const handleClose = () => {
        setRating(0);
        setReview('');
        setIsAnonymous(false);
        onClose();
    };

    const getLabelText = (value) => {
        return `${value} Star${value !== 1 ? 's' : ''}, ${labels[value]}`;
    };

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
            <DialogTitle component="div">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <StarIcon color="warning" />
                    <Typography variant="h6">Rate Your Appointment</Typography>
                </Box>
            </DialogTitle>
            <DialogContent>
                {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                )}

                <Box sx={{ textAlign: 'center', my: 3 }}>
                    <Typography variant="body1" color="text.secondary" gutterBottom>
                        How was your experience?
                    </Typography>
                    <Rating
                        name="appointment-rating"
                        value={rating}
                        precision={1}
                        size="large"
                        getLabelText={getLabelText}
                        onChange={(event, newValue) => setRating(newValue)}
                        onChangeActive={(event, newHover) => setHover(newHover)}
                        emptyIcon={<StarIcon style={{ opacity: 0.55 }} fontSize="inherit" />}
                        sx={{ fontSize: 48 }}
                    />
                    {rating !== null && (
                        <Typography variant="body1" sx={{ mt: 1, fontWeight: 'medium' }}>
                            {labels[hover !== -1 ? hover : rating]}
                        </Typography>
                    )}
                </Box>

                <TextField
                    fullWidth
                    multiline
                    rows={4}
                    label="Write a review (optional)"
                    placeholder="Share your experience with this doctor..."
                    value={review}
                    onChange={(e) => setReview(e.target.value)}
                    variant="outlined"
                    sx={{ mb: 2 }}
                />

                <FormControlLabel
                    control={
                        <Checkbox
                            checked={isAnonymous}
                            onChange={(e) => setIsAnonymous(e.target.checked)}
                        />
                    }
                    label="Submit anonymously"
                />
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button onClick={handleClose} disabled={loading}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    onClick={handleSubmit}
                    disabled={rating === 0 || loading}
                    startIcon={loading ? <CircularProgress size={20} /> : <StarIcon />}
                >
                    {loading ? 'Submitting...' : 'Submit Rating'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default RatingDialog;
