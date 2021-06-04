import { Component, OnInit } from '@angular/core';
import { Observable, of } from 'rxjs';
import { TeslaFolder } from '../models/TeslaFolder';
import { TeslaFolderService } from '../services/tesla-folder.service';
import { catchError } from 'rxjs/operators';

@Component({
  selector: 'app-tesla-folder-list',
  templateUrl: './tesla-folder-list.component.html',
  styleUrls: ['./tesla-folder-list.component.css']
})
export class TeslaFolderListComponent implements OnInit {

  teslaFolders$: Observable<TeslaFolder[]>;
  error:string;
  search = "";
  constructor(private teslaFolderService: TeslaFolderService) { }

  ngOnInit() {
    this.teslaFolders$ = this.teslaFolderService.getTeslaFolders()
    .pipe(catchError((err) => {
      console.log(err);
      this.error = err.error;
      return of;
    }));
  }

}
