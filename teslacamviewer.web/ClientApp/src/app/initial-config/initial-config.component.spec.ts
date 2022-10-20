import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { InitialConfigComponent } from './initial-config.component';

describe('InitialConfigComponent', () => {
  let component: InitialConfigComponent;
  let fixture: ComponentFixture<InitialConfigComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ InitialConfigComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(InitialConfigComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
