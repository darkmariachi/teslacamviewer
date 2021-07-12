import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, Subject } from 'rxjs';
import { ConfigurationModel } from 'src/app/models/ConfigurationModel';

@Injectable({
  providedIn: 'root'
})
export class LoginService {

  private readonly apiEndpoint = 'api/configuration';

  constructor(
    private router: Router,
    private httpClient: HttpClient) { 

  }

  get jwtToken(): string {
    return localStorage.getItem('jwtToken');
  }

  set jwtToken(val: string) {
    if( val === null) {
      localStorage.removeItem('jwtToken');
      return;
    }
    localStorage.setItem('jwtToken', val);
  }
  
  login(password: string): Observable<any> {
    var subject = new Subject<any>();
    this.httpClient.post(`${this.apiEndpoint}/login`, {password: password})
    .subscribe((res: any) => {
      this.jwtToken = res.token;
      subject.next(null);
    }, (err) => {
      subject.next(err);
    });
    return subject.asObservable();
  }
  
  logout(): void {
    this.jwtToken = null;
    this.router.navigate(['login'])
  }
  

  initializeConfig(config: ConfigurationModel) {
    return this.httpClient.post(`${this.apiEndpoint}`, config);
  }

  get isLoggedIn() {
    return this.jwtToken !== undefined && this.jwtToken !== null;
  }
}
