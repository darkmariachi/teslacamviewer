import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ConfigService {

  private readonly apiEndpoint = 'api/Configuration';
  constructor(private httpClient: HttpClient) {}

  getConfig() {
    return this.httpClient.get(this.apiEndpoint);
  }
}
