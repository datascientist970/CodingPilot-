"""Example file for trying DevPilot: Scan Current File."""

# DevPilot should flag: meaningless name, unused variable, undefined name,
# bare except, and the unused function below.

temp = 42
unused_value = "never used"


def calculateTotal(price, quantity):
    return price * quantity


def helperNeverCalled():
    return True


def main():
    total = calculateTotal(10, 3)
    print(total)
    print(missing_name)
    try:
        risky = 1 / 0
    except:
        print("oops")


if __name__ == "__main__":
    main()
