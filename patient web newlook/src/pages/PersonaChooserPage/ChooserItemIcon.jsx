/**
 * ChooserItemIcon — renders a chooser item's admin-typed ``icon_key``.
 *
 * Three surfaces render these items (the tile pages and the navbar's desktop
 * dropdown + mobile drawer), so the fallback lives here once rather than
 * three times: an ``icon_key`` the admin typo'd (or never set) resolves to
 * nothing, and a bad key should cost an icon, not leave an unlabelled tile.
 */
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

import MuiIcon from '../../common/components/MuiIcon/MuiIcon';

export default function ChooserItemIcon({ item, ...props }) {
    return <MuiIcon name={item.iconKey} fallback={<HelpOutlineIcon {...props} />} {...props} />;
}
