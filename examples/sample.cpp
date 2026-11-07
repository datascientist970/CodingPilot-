// Example file for trying DevPilot: Scan Current File.
// DevPilot should flag: the unused variable, the unused function,
// and the unsafe strcpy call.

#include <cstring>
#include <iostream>

int addNumbers(int a, int b) {
    return a + b;
}

int neverCalled() {
    return 0;
}

int main() {
    int unusedCounter = 0;
    char buffer[16];
    strcpy(buffer, "hello");
    std::cout << addNumbers(2, 3) << std::endl;
    return 0;
}
