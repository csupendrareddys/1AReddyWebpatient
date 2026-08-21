/**
 * resolveStagedGalleryUploads — turn a module/feature patch's staged gallery
 * files into persisted rows, right before the Save Draft PUT.
 *
 * MediaListEditor stages picked files as `{ _file, _fileName, ... }` rows
 * inside `img_json.images` / `vid_json.videos` instead of uploading on pick.
 * The editor's handleSave calls this to upload each staged file to S3 and
 * swap it for `{ <urlField>, s3_key, ... }`, so nothing hits S3 until the
 * admin saves and no orphan is created by an abandoned edit.
 *
 * `uploadAsset(file, kind)` must resolve to `{ url, s3_key }` (the tenant or
 * platform landing upload-asset endpoint). Only the media keys present in the
 * patch are touched; a patch that didn't change galleries passes through
 * untouched.
 */
const MEDIA = [
    { jsonKey: 'img_json', itemsKey: 'images', urlField: 'image_url', kind: 'image' },
    { jsonKey: 'vid_json', itemsKey: 'videos', urlField: 'video_url', kind: 'video' },
];

export default async function resolveStagedGalleryUploads(data, uploadAsset) {
    if (!data) return data;
    const out = { ...data };
    for (const m of MEDIA) {
        const gallery = data[m.jsonKey];
        const items = gallery?.[m.itemsKey];
        if (!Array.isArray(items) || !items.some((it) => it && it._file)) continue;

        const resolved = [];
        for (const it of items) {
            if (it && it._file) {
                // eslint-disable-next-line no-await-in-loop
                const res = await uploadAsset(it._file, m.kind);
                // Drop the transient staging fields; keep the rest of the row.
                const { _file, _fileName, ...rest } = it;
                resolved.push({ ...rest, [m.urlField]: res.url, s3_key: res.s3_key });
            } else {
                resolved.push(it);
            }
        }
        out[m.jsonKey] = { ...gallery, [m.itemsKey]: resolved };
    }
    return out;
}
