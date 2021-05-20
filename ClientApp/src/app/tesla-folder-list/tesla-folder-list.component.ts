import { Component, OnInit } from '@angular/core';
import { Observable } from 'rxjs';
import { TeslaFolder } from '../models/TeslaFolder';
import { TeslaFolderService } from '../services/tesla-folder.service';

@Component({
  selector: 'app-tesla-folder-list',
  templateUrl: './tesla-folder-list.component.html',
  styleUrls: ['./tesla-folder-list.component.css']
})
export class TeslaFolderListComponent implements OnInit {

  teslaFolders$: Observable<TeslaFolder[]>;
  constructor(private teslaFolderService: TeslaFolderService) { }

  ngOnInit() {
    this.teslaFolders$ = this.teslaFolderService.getTeslaFolders();
  }

}
