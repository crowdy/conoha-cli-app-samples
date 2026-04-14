import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex justify-center py-20">
      <SignUp />
    </div>
  );
}
