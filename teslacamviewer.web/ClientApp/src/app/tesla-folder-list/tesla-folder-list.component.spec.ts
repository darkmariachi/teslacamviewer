import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { TeslaFolderListComponent } from './tesla-folder-list.component';

describe('TeslaFolderListComponent', () => {
  let component: TeslaFolderListComponent;
  let fixture: ComponentFixture<TeslaFolderListComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ TeslaFolderListComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(TeslaFolderListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
