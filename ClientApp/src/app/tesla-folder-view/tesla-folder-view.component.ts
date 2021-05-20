import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, of, Subject } from 'rxjs';
import { TeslaFolder } from '../models/TeslaFolder';
import { TeslaFolderService } from '../services/tesla-folder.service';
import { catchError } from 'rxjs/operators';
import { SideEnum } from '../enums/SideEnum';

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

  constructor(
    private route: ActivatedRoute,
    private teslaFolderService: TeslaFolderService) { }

  ngOnInit() {
    this.route.params.subscribe(params => {
      const folderName = params['folderName'];
      this.teslaFolderService.getTeslaFolder(folderName)
      .subscribe(res => {
        this.teslaFolder = res;
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

}
