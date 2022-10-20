import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { TeslaFolder } from '../models/TeslaFolder';

@Injectable({
  providedIn: 'root'
})
export class TeslaFolderService {

  private readonly apiEndpoint = "api/teslaFolder";

  constructor(private http: HttpClient) { }

  getTeslaFolders(): Observable<TeslaFolder[]> {
    return this.http.get<TeslaFolder[]>(`${this.apiEndpoint}`);
  }

  getTeslaFolder(folderName: string, folderType: string): Observable<TeslaFolder> {
    return this.http.get<TeslaFolder>(`${this.apiEndpoint}/${folderType}/${folderName}`);
  }

  deleteTeslaFolder(folder: TeslaFolder) {
    return this.http.delete(`${this.apiEndpoint}/${folder.folderType}/${folder.name}`);
  }
}
