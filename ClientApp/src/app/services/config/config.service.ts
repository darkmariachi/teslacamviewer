import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ChangePasswordModel } from 'src/app/models/ChangePasswordModel';

@Injectable({
  providedIn: 'root'
})
export class ConfigService {

  private readonly apiEndpoint = 'api/Configuration';
  constructor(private httpClient: HttpClient) {}

  getConfig() {
    return this.httpClient.get(this.apiEndpoint);
  }

  changePassword(changePassword: ChangePasswordModel) {
    return this.httpClient.patch(`${this.apiEndpoint}/changePassword`, changePassword);
  }
}
