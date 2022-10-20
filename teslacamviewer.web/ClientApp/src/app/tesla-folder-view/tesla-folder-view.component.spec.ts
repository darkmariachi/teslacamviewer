import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { TeslaFolderViewComponent } from './tesla-folder-view.component';

describe('TeslaFolderViewComponent', () => {
  let component: TeslaFolderViewComponent;
  let fixture: ComponentFixture<TeslaFolderViewComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ TeslaFolderViewComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(TeslaFolderViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
