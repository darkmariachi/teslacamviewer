import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, of, Subject } from 'rxjs';
import { TeslaFolder } from '../models/TeslaFolder';
import { TeslaFolderService } from '../services/tesla-folder.service';

import { SideEnum } from '../enums/SideEnum';
import { TeslaClip } from '../models/TeslaClip';

@Component({
  selector: 'app-tesla-folder-view',
  templateUrl: './tesla-folder-view.component.html',
  styleUrls: ['./tesla-folder-view.component.css']
})
export class TeslaFolderViewComponent implements OnInit {

  teslaFolder: TeslaFolder;
  error = false;
  loading = true;
  loadingError$ = new Subject<boolean>();
  currentlyOpenGroup: TeslaClip[];
  playing = false;

  private fullScreenClip: TeslaClip[];

  constructor(
    private route: ActivatedRoute,
    private teslaFolderService: TeslaFolderService,
    ) { }

  ngOnInit() {
    this.route.params.subscribe(params => {
      const folderName = params['folderName'];
      const folderType = params['folderType'];
      this.teslaFolderService.getTeslaFolder(folderName, folderType)
      .subscribe(res => {
        this.teslaFolder = res;
        this.open(res.teslaClipsGroupedByDate[0]);
      }, (err) => {
        this.error = true;
      }, () => {
        this.loading = false;
      });
    });
  }

  getEnumName(enumerator: SideEnum): string {
    return SideEnum[enumerator];
  }

  getMediaId(clipDate: string, side: SideEnum) {
    return `${clipDate}${side}`
  }

  open(group: TeslaClip[]) {
    if (this.isCurrentlyOpen(group)) {
      this.currentlyOpenGroup = null;
      return;
    }
    this.currentlyOpenGroup = group;
    this.playing = false;
  }

  isCurrentlyOpen(group: TeslaClip[]) {
    return this.currentlyOpenGroup == group;
  }

  fastForward(clipDate: string, forward: boolean) {
    const clips = this.getClips(clipDate);
    let delta = 10
    if (!forward) {
      delta = -10;
    }
    clips.forEach(c => {
      const video = this.getHTMLVideoElement(c);
      if (!video.paused) {
        video.currentTime = video.currentTime + delta;
      }
    });
  }

  play (clipDate: string) {
    const clips = this.getClips(clipDate);
    clips.forEach(c => {
      const video = this.getHTMLVideoElement(c);
      if (video.paused) {
        video.play();
        this.playing = true;
      } else {
        video.pause();
        this.playing = false;
      }
     });
  }

  fullscreen(teslaClipsGrouped: TeslaClip[]) {
    if (!this.fullScreenClip) this.fullScreenClip = teslaClipsGrouped;
    else this.fullScreenClip = null;
  }

  isFullscreen(teslaClipsGrouped: TeslaClip[]) {
    return this.fullScreenClip == teslaClipsGrouped;
  }

  private getClips(clipDate: string) {
    return [
      this.getMediaId(clipDate, SideEnum.Back),
      this.getMediaId(clipDate, SideEnum.Front),
      this.getMediaId(clipDate, SideEnum.Left),
      this.getMediaId(clipDate, SideEnum.Right)
    ];
  }

  private getHTMLVideoElement(c: string): HTMLVideoElement {
    return <HTMLVideoElement>document.getElementById(c);
  }

}
