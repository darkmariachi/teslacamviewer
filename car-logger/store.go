package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// Record is one line of the log. Records are identified by file number and line, which stay
// stable whatever the Pi's clock says: it has no battery-backed clock and only sets its time on
// home Wi-Fi, so away from home its time is wrong.
type Record struct {
	Kind Kind `json:"kind"`
	Mode Mode `json:"mode"`
	// CarTime is the car's own timestamp for the reading, or an estimate carried forward from the
	// last one (CarTimeEstimated) for readings that have none, such as the body check.
	CarTime          *time.Time      `json:"carTime,omitempty"`
	CarTimeEstimated bool            `json:"carTimeEstimated,omitempty"`
	PiTime           time.Time       `json:"piTime"`
	Data             json.RawMessage `json:"data"`
}

// Store appends records to numbered JSON Lines files: 000001.jsonl, 000002.jsonl, …
// Each line is synced to disk before the next, because the car cuts the Pi's power without warning.
type Store struct {
	dir      string
	maxFile  int64 // start a new file past this size
	maxTotal int64 // delete the oldest files past this total
	file     *os.File
	number   int
	size     int64
	current  atomic.Int64 // the file being written, read by the sync server
	logID    string
}

func OpenStore(dir string, maxFile, maxTotal int64) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &Store{dir: dir, maxFile: maxFile, maxTotal: maxTotal}
	id, err := LoadOrCreateSecret(filepath.Join(dir, "log-id"))
	if err != nil {
		return nil, err
	}
	s.logID = id
	numbers, err := s.numbers()
	if err != nil {
		return nil, err
	}
	// Always start a fresh file: the last one may end in a line cut short by a power loss.
	next := 1
	if len(numbers) > 0 {
		next = numbers[len(numbers)-1] + 1
	}
	return s, s.open(next)
}

func fileName(number int) string { return fmt.Sprintf("%06d.jsonl", number) }

func (s *Store) open(number int) error {
	f, err := os.OpenFile(filepath.Join(s.dir, fileName(number)), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return err
	}
	s.file, s.number, s.size = f, number, info.Size()
	s.current.Store(int64(number))
	return nil
}

// Current is the number of the file being written.
func (s *Store) Current() int { return int(s.current.Load()) }

// numbers lists the existing log files, oldest first.
func (s *Store) numbers() ([]int, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	var numbers []int
	for _, e := range entries {
		name, ok := strings.CutSuffix(e.Name(), ".jsonl")
		if n, err := strconv.Atoi(name); ok && err == nil && !e.IsDir() {
			numbers = append(numbers, n)
		}
	}
	sort.Ints(numbers)
	return numbers, nil
}

func (s *Store) Append(r Record) error {
	line, err := json.Marshal(r)
	if err != nil {
		return err
	}
	if s.size > 0 && s.size+int64(len(line))+1 > s.maxFile {
		if err := s.rotate(); err != nil {
			return err
		}
	}
	n, err := s.file.Write(append(line, '\n'))
	s.size += int64(n)
	if err != nil {
		return err
	}
	return s.file.Sync()
}

func (s *Store) rotate() error {
	s.file.Close()
	if err := s.open(s.number + 1); err != nil {
		return err
	}
	return s.prune()
}

// prune deletes the oldest files once the log outgrows its budget. Syncing with TeslaCam will
// normally clear them long before that; this only protects the Pi's small partition.
func (s *Store) prune() error {
	numbers, err := s.numbers()
	if err != nil {
		return err
	}
	var total int64
	sizes := map[int]int64{}
	for _, n := range numbers {
		if info, err := os.Stat(filepath.Join(s.dir, fileName(n))); err == nil {
			sizes[n] = info.Size()
			total += info.Size()
		}
	}
	for _, n := range numbers {
		if total <= s.maxTotal || n == s.number {
			break
		}
		if err := os.Remove(filepath.Join(s.dir, fileName(n))); err != nil {
			return err
		}
		total -= sizes[n]
	}
	return nil
}

func (s *Store) Close() error {
	if s.file == nil {
		return nil
	}
	return s.file.Close()
}

// CarClock carries the car's time forward between readings that report it, using the Pi's
// monotonic clock, which is right even when its wall clock is not.
type CarClock struct {
	last   time.Time
	seenAt time.Time // Pi time (with monotonic reading) when last was seen
}

func (c *CarClock) Observe(carTime, piNow time.Time) {
	c.last, c.seenAt = carTime, piNow
}

// Estimate returns the car's time now, if it has ever been seen since the logger started.
func (c *CarClock) Estimate(piNow time.Time) (time.Time, bool) {
	if c.last.IsZero() {
		return time.Time{}, false
	}
	return c.last.Add(piNow.Sub(c.seenAt)), true
}
