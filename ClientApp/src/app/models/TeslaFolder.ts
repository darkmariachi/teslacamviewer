import { TeslaClip } from "./TeslaClip";
import { TeslaEvent } from "./TeslaEvent";

export class TeslaFolder {
    name: string;
    actualPath: string;
    thumbnail: boolean;
    teslaEvent: TeslaEvent;
    teslaClipsGroupedByDate: TeslaClip[][];
}