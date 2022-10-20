import { TestBed } from '@angular/core/testing';

import { TeslaFolderService } from './tesla-folder.service';

describe('TeslaFolderServiceService', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  it('should be created', () => {
    const service: TeslaFolderService = TestBed.get(TeslaFolderService);
    expect(service).toBeTruthy();
  });
});
