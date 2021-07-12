import { HttpErrorResponse, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs/operators';
import { LoginService } from './services/login/login.service';

@Injectable({
  providedIn: 'root'
})
export class AuthInterceptorService implements HttpInterceptor {

  constructor(
    private loginService: LoginService,
    private router: Router) { }

  intercept(req: HttpRequest<any>, next: HttpHandler) {
    const authreq = req.clone({
      setHeaders: {
        'Content-Type': 'application/json',
        Authorization: `${this.loginService.jwtToken}`
      }
    });

    return next.handle(req).pipe( tap(() => {},
    (err: any) => {
    if (err instanceof HttpErrorResponse) {
      if (err.status !== 401) {
       return;
      }
      this.router.navigate(['login']);
    }
  }));
  }
}
