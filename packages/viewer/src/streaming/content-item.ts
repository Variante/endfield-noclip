import type { BlobKind } from '@endfield-noclip/package-format/blobs';

import type { Decoded } from '../package/decode-protocol.ts';

import type { Resident } from './resident.ts';

/** lifecycle of a blob */
export type ItemState = 'idle' | 'queued' | 'fetching' | 'decoding' | 'uploading' | 'ready' | 'failed';

/** a blob the viewer has asked for at some point */
export interface ContentItem {
	blob: number;
	kind: BlobKind;
	/** index of the archive holding the blob */
	archive: number;
	state: ItemState;
	/** part of the always-resident coarse layer */
	pinned: boolean;
	/** highest priority requested in {@link wantedFrame} */
	priority: number;
	wantedFrame: number;
	/** last frame it was used: wanted or marked used while resident, or uploaded */
	usedFrame: number;
	decoded: Decoded | null;
	/** set exactly while the item is `ready` */
	resident: Resident | null;
}
