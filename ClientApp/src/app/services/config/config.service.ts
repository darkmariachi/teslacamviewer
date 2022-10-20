import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ChangePasswordModel } from 'src/app/models/ChangePasswordModel';
import { TeslaPublicConfig } from 'src/app/models/TeslaPublicConfig';
import { map, startWith } from 'rxjs/operators';
import { Observable, ReplaySubject, Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ConfigService {

  private readonly apiEndpoint = 'api/Configuration';
  authEnabled$: ReplaySubject<boolean> = new ReplaySubject<boolean>();
  constructor(private httpClient: HttpClient) {
    this.getConfig().subscribe(res => this.authEnabled$.next(res.isAuthorizationEnabled));
  }

  getConfig(): Observable<TeslaPublicConfig> {
    return this.httpClient.get<TeslaPublicConfig>(this.apiEndpoint);
  }

  changePassword(changePassword: ChangePasswordModel) {
    return this.httpClient.patch(`${this.apiEndpoint}/changePassword`, changePassword);
  }
}
