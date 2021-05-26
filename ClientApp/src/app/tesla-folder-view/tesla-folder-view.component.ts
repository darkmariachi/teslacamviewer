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

  constructor(
    private route: ActivatedRoute,
    private teslaFolderService: TeslaFolderService,
    ) { }

  ngOnInit() {
    this.route.params.subscribe(params => {
      const folderName = params['folderName'];
      this.teslaFolderService.getTeslaFolder(folderName)
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

  play (clipDate: string) {
    const clips = [
      this.getMediaId(clipDate, SideEnum.Back),
      this.getMediaId(clipDate, SideEnum.Front),
      this.getMediaId(clipDate, SideEnum.Left),
      this.getMediaId(clipDate, SideEnum.Right)
    ];
    clips.forEach(c => {
      const video = <HTMLVideoElement>document.getElementById(c);
      if (video.paused) {
        video.play();
        this.playing = true;
      } else {
        video.pause();
        this.playing = false;
      }
     });
  }

}
